# -*- coding: utf-8 -*-
from __future__ import print_function

import json
import threading
import time
import uuid
import os
try:
    from http.server import BaseHTTPRequestHandler, HTTPServer
    from socketserver import ThreadingMixIn
except ImportError:
    from BaseHTTPServer import BaseHTTPRequestHandler, HTTPServer
    from SocketServer import ThreadingMixIn
try:
    from urllib.parse import urlparse, parse_qs
except ImportError:
    from urlparse import urlparse, parse_qs

try:
    import websocket
except ImportError:
    websocket = None

import socket
import struct
import subprocess
HOST = "0.0.0.0"
PORT = 8080
MACRODECK_HOST = ""
MACRODECK_PORT = 8191

SESSIONS = {}
LOCK = threading.RLock()

APPDATA_DIR = os.path.join(os.environ.get("APPDATA", os.path.expanduser("~")), "TPMacroDeck")
try:
    os.makedirs(APPDATA_DIR, exist_ok=True)
except Exception:
    pass
CONFIG_FILE = os.path.join(APPDATA_DIR, "tp_macrodeck_config.json")

def load_config():
    try:
        with open(CONFIG_FILE, "r", encoding="utf-8") as f:
            cfg = json.load(f)
            if isinstance(cfg, dict):
                return cfg
    except Exception:
        pass
    return {"macrodeck_host": "", "macrodeck_port": MACRODECK_PORT}

def save_config(cfg):
    try:
        os.makedirs(APPDATA_DIR, exist_ok=True)
        with open(CONFIG_FILE, "w", encoding="utf-8") as f:
            json.dump(cfg, f, ensure_ascii=False, indent=2)
        return True
    except Exception as e:
        print("[HATA] Ayarlar kaydedilemedi:", e)
        return False



class Session(object):
    def __init__(self, sid, host):
        self.sid = sid
        self.host = host or MACRODECK_HOST
        self.ws = None
        self.connected = False
        self.queue = []
        self.lock = threading.RLock()
        self.stop = False

    def push(self, obj):
        with self.lock:
            self.queue.append(obj)
            if len(self.queue) > 300:
                self.queue = self.queue[-300:]

    def pop(self):
        with self.lock:
            q = self.queue
            self.queue = []
            return q

    def send(self, obj):
        data = json.dumps(obj, separators=(",", ":"))
        with self.lock:
            if self.ws and self.connected:
                try:
                    self.ws.send(data)
                    return True
                except Exception:
                    self.connected = False
        return False

    def connect(self):
        if websocket is None:
            self.push({"BridgeError": "websocket-client paketi yok"})
            return

        def worker():
            while not self.stop:
                try:
                    url = "ws://%s:%d/" % (self.host, MACRODECK_PORT)
                    ws = websocket.create_connection(
                        url,
                        timeout=5,
                        origin="http://%s:%d" % (self.host, PORT)
                    )
                    # create_connection(timeout=5) sets the socket read timeout too.
                    # Macro Deck can legitimately stay silent for minutes. Clear the
                    # read timeout after the handshake so recv() stays connected.
                    try:
                        ws.settimeout(None)
                    except Exception:
                        pass

                    with self.lock:
                        self.ws = ws
                        self.connected = True

                    # Same handshake as the working V18 browser client.
                    self.send({
                        "Method": "CONNECTED",
                        "Client-Id": self.sid,
                        "API": 20,
                        "Device-Type": "Web"
                    })

                    while not self.stop:
                        try:
                            raw = ws.recv()
                            if raw is None:
                                break
                            try:
                                obj = json.loads(raw)
                                self.push(obj)
                            except Exception:
                                pass
                        except Exception:
                            break

                except Exception as e:
                    with self.lock:
                        self.connected = False
                        self.ws = None
                    self.push({"BridgeStatus": "disconnected"})

                finally:
                    with self.lock:
                        try:
                            if self.ws:
                                self.ws.close()
                        except Exception:
                            pass
                        self.ws = None
                        self.connected = False

                if not self.stop:
                    time.sleep(1.5)

        t = threading.Thread(target=worker)
        t.daemon = True
        t.start()


def get_session(sid, host=None):
    with LOCK:
        s = SESSIONS.get(sid)
        if s is None:
            s = Session(sid, host or MACRODECK_HOST)
            SESSIONS[sid] = s
            s.connect()
        return s



def first_launch_setup():
    global MACRODECK_HOST, MACRODECK_PORT

    cfg = load_config()
    saved_host = (cfg.get("macrodeck_host") or "").strip()
    saved_port = str(cfg.get("macrodeck_port") or MACRODECK_PORT).strip()

    try:
        import tkinter as tk
        from tkinter import messagebox
    except Exception:
        # Fallback for running directly from source without Tk.
        host = input("Macro Deck IP: ").strip()
        port = input("Macro Deck Port [8191]: ").strip() or "8191"
        try:
            port_num = int(port)
        except ValueError:
            return False
        MACRODECK_HOST, MACRODECK_PORT = host, port_num
        save_config({"macrodeck_host": host, "macrodeck_port": port_num})
        return bool(host)

    result = {"ok": False}

    root = tk.Tk()
    root.title("TP Macro Deck Client")
    root.resizable(False, False)
    root.attributes("-topmost", True)

    frame = tk.Frame(root, padx=24, pady=20)
    frame.pack()

    tk.Label(frame, text="TP Macro Deck Client",
             font=("Segoe UI", 16, "bold")).pack(pady=(0, 6))
    tk.Label(frame, text="Macro Deck bağlantı ayarları",
             font=("Segoe UI", 10)).pack(pady=(0, 16))

    tk.Label(frame, text="Macro Deck IP Adresi",
             anchor="w").pack(fill="x")
    ip_var = tk.StringVar(value=saved_host)
    ip_entry = tk.Entry(frame, textvariable=ip_var, width=32)
    ip_entry.pack(pady=(4, 12))

    tk.Label(frame, text="Macro Deck Port",
             anchor="w").pack(fill="x")
    port_var = tk.StringVar(value=saved_port or "8191")
    port_entry = tk.Entry(frame, textvariable=port_var, width=32)
    port_entry.pack(pady=(4, 16))

    status = tk.Label(frame, text="", anchor="w")
    status.pack(fill="x", pady=(0, 8))

    def save_and_start():
        host = ip_var.get().strip()
        port_text = port_var.get().strip() or "8191"

        if not host:
            status.config(text="IP adresini girin.")
            ip_entry.focus_set()
            return

        try:
            port_num = int(port_text)
            if not 1 <= port_num <= 65535:
                raise ValueError()
        except ValueError:
            status.config(text="Geçerli bir port girin.")
            port_entry.focus_set()
            return

        global MACRODECK_HOST, MACRODECK_PORT
        MACRODECK_HOST = host
        MACRODECK_PORT = port_num

        if save_config({
            "macrodeck_host": host,
            "macrodeck_port": port_num
        }) is False:
            pass

        result["ok"] = True
        root.destroy()

    def cancel():
        root.destroy()

    tk.Button(frame, text="BAĞLAN", width=20,
              command=save_and_start).pack(pady=(2, 4))
    tk.Button(frame, text="İPTAL", width=20,
              command=cancel).pack()

    root.bind("<Return>", lambda e: save_and_start())
    root.protocol("WM_DELETE_WINDOW", cancel)
    ip_entry.focus_set()

    root.mainloop()
    return result["ok"]


# ---------- TP custom USB protocol ----------
TP_PROTO_MAGIC = 0x54504D31  # TPM1
TP_PROTO_PORT = 8765

class TPUsbConnection(object):
    def __init__(self, sock):
        self.sock=sock
        self.lock=threading.RLock()

    def send(self, line):
        if isinstance(line, dict):
            line=json.dumps(line,separators=(",",":"))
        if not line.endswith("\n"):
            line += "\n"
        with self.lock:
            self.sock.sendall(line.encode("utf-8"))

    def recv(self):
        data=b""
        while not data.endswith(b"\n"):
            part=self.sock.recv(4096)
            if not part:
                return None
            data += part
            if len(data)>1024*1024:
                raise ValueError("USB line too large")
        return data.decode("utf-8").strip()

    def close(self):
        try:self.sock.shutdown(socket.SHUT_RDWR)
        except Exception:pass
        try:self.sock.close()
        except Exception:pass



TP_USB_CONN=None
TP_USB_STOP_EVENT=threading.Event()
TP_USB_LOCK=threading.RLock()

def tp_usb_protocol_client(serial=None):
    global TP_USB_CONN

    print("[USB] Android USB protokolü bekleniyor: 127.0.0.1:%d" % TP_USB_FORWARD_PORT)

    while not TP_USB_STOP_EVENT.is_set():
        conn = None
        reader_alive = False
        state = {"sid": "TP_USB"}

        try:
            sock = socket.create_connection(
                ("127.0.0.1", TP_USB_FORWARD_PORT), timeout=5)
            sock.settimeout(None)
            try:
                sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
            except Exception:
                pass

            conn = TPUsbConnection(sock)

            with TP_USB_LOCK:
                old = TP_USB_CONN
                TP_USB_CONN = conn

            if old is not None and old is not conn:
                old.close()

            # Native Android sends TP_READY immediately after accept().
            first = conn.recv()
            print("[USB] Android cevap:", first)

            if first != "TP_READY":
                print("[USB] Beklenmeyen Android cevabı.")
                raise RuntimeError("TP_READY alınamadı")

            print("[USB] Android USB server HAZIR.")
            reader_alive = True

            def reader():
                nonlocal reader_alive

                try:
                    while reader_alive and not TP_USB_STOP_EVENT.is_set():
                        msg = conn.recv()
                        if msg is None:
                            break

                        if not msg:
                            continue

                        # Transport messages.
                        if msg == "TP_PONG":
                            continue
                        if msg == "TP_READY":
                            continue

                        # APK -> PC JSON message.
                        try:
                            obj = json.loads(msg)
                        except Exception:
                            print("[USB] Geçersiz JSON:", msg[:120])
                            continue

                        if not isinstance(obj, dict):
                            continue

                        sid = obj.get("Client-Id") or obj.get("clientId")
                        if sid:
                            state["sid"] = sid

                        sess = get_session(state["sid"], MACRODECK_HOST)

                        if sess:
                            if obj.get("Method") == "CONNECTED":
                                print("[USB] CONNECTED -> Macro Deck")
                            elif obj.get("Method") in (
                                "BUTTON_PRESS",
                                "BUTTON_LONG_PRESS",
                                "BUTTON_RELEASE",
                                "BUTTON_LONG_PRESS_RELEASE"
                            ):
                                print("[USB] %s -> Macro Deck" % obj.get("Method"))
                            sess.send(obj)

                except Exception as e:
                    print("[USB] Android -> PC okuyucu sonlandı:", e)
                finally:
                    reader_alive = False

            reader_thread = threading.Thread(
                target=reader, daemon=True)
            reader_thread.start()

            # PC -> Android. The reader thread owns recv(); this loop ONLY sends.
            sess = get_session(state["sid"], MACRODECK_HOST)
            sess.send({
                "Method": "CONNECTED",
                "Client-Id": state["sid"],
                "API": 20,
                "Device-Type": "Web"
            })
            print("[USB] CONNECTED -> Macro Deck")

            while reader_alive and not TP_USB_STOP_EVENT.is_set():
                if sess:
                    for queued in sess.pop():
                        try:
                            conn.send(queued)
                        except Exception:
                            reader_alive = False
                            break

                # Keep transport alive; Android answers TP_PONG in its native loop.
                try:
                    conn.send("TP_PING")
                except Exception:
                    reader_alive = False
                    break

                time.sleep(0.05)

        except Exception as e:
            print("[USB] Android USB protokolü bekleniyor:", e)

        finally:
            reader_alive = False
            with TP_USB_LOCK:
                if TP_USB_CONN is conn:
                    TP_USB_CONN = None
            if conn:
                conn.close()

        TP_USB_STOP_EVENT.wait(1.0)



# ===== TP CUSTOM USB ADB FORWARD =====


# ===== ISOLATED ADB SERVER =====
# Use a dedicated ADB server port so another adb.exe/Android Studio instance
# cannot lock up the bundled ADB process used by TP Macro Deck.
TP_ADB_SERVER_PORT = 5038
TP_USB_FORWARD_PORT = 18765
TP_ANDROID_USB_PORT = 8765

def tp_find_adb():
    base=os.path.dirname(os.path.abspath(__file__))
    candidates=[
        os.path.join(base, "adb.exe"),
        os.path.join(base, "adb", "adb.exe"),
        "adb.exe"
    ]
    for p in candidates:
        if os.path.isfile(p):
            return p
    return None

TP_USB_ADB_PATH = tp_find_adb()

def tp_adb_env():
    env=os.environ.copy()
    # Modern adb supports ADB_SERVER_SOCKET. Keep the bundled client isolated.
    env["ADB_SERVER_SOCKET"]="tcp:127.0.0.1:%d" % TP_ADB_SERVER_PORT
    env["ANDROID_ADB_SERVER_PORT"]=str(TP_ADB_SERVER_PORT)
    return env

def tp_adb_run(args, timeout=8):
    if not TP_USB_ADB_PATH:
        return None, "[USB] adb.exe bulunamadi."

    try:
        p=subprocess.run(
            [TP_USB_ADB_PATH] + list(args),
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            timeout=timeout,
            env=tp_adb_env(),
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0)
        )
        return p, p.stdout.strip()
    except subprocess.TimeoutExpired:
        return None, "[USB] ADB komutu zaman asimina ugradi: " + " ".join(args)
    except Exception as e:
        return None, "[USB] ADB hata: " + str(e)

def tp_adb_start_server():
    p,out=tp_adb_run(
        ["-P",str(TP_ADB_SERVER_PORT),"start-server"],
        timeout=12
    )
    if p is None:
        print(out)
        return False

    if p.returncode != 0:
        print("[USB] ADB server baslatilamadi:", out)
        return False

    print("[USB] Izole ADB server aktif: 127.0.0.1:%d" % TP_ADB_SERVER_PORT)
    return True

def tp_adb_devices():
    p,out=tp_adb_run(
        ["-P",str(TP_ADB_SERVER_PORT),"devices"],
        timeout=6
    )
    if p is None:
        print(out)
        return None

    if p.returncode != 0:
        print("[USB] ADB devices hata:",out)
        return None

    result=[]
    for line in out.splitlines():
        parts=line.strip().split()
        if len(parts)>=2 and parts[1]=="device":
            result.append(parts[0])

    return result

def tp_adb_forward(serial):
    # Remove stale mapping, then create a fresh isolated forward.
    tp_adb_run(
        ["-P",str(TP_ADB_SERVER_PORT),"-s",serial,
         "forward","--remove","tcp:%d"%TP_USB_FORWARD_PORT],
        timeout=3
    )

    p,out=tp_adb_run(
        ["-P",str(TP_ADB_SERVER_PORT),"-s",serial,
         "forward",
         "tcp:%d"%TP_USB_FORWARD_PORT,
         "tcp:%d"%TP_ANDROID_USB_PORT],
        timeout=6
    )

    if p is None or p.returncode != 0:
        print("[USB] ADB forward basarisiz:", out)
        return False

    q,qout=tp_adb_run(
        ["-P",str(TP_ADB_SERVER_PORT),"-s",serial,"forward","--list"],
        timeout=4
    )

    if q is not None and q.returncode == 0:
        print("[USB] ADB forward list:")
        print(qout)

    print("[USB] Forward hazir: PC tcp:%d -> Tablet tcp:%d" %
          (TP_USB_FORWARD_PORT,TP_ANDROID_USB_PORT))
    return True

def tp_usb_forward_worker():
    global TP_USB_CONN

    print("[USB] Izole ADB USB servisi basliyor...")
    if not tp_adb_start_server():
        print("[USB] Izole ADB baslatilamadi.")
        return

    last=None

    while not TP_USB_STOP_EVENT.is_set():
        devices=tp_adb_devices()

        if devices is None:
            # Do not spin. Restart only after a real ADB failure.
            time.sleep(2)
            continue

        serial=devices[0] if devices else None

        if serial != last:
            if serial:
                print("[USB] Tablet bulundu:",serial)
                TP_USB_STOP_EVENT.clear()

                if tp_adb_forward(serial):
                    print("[USB] TP USB transport hazir.")
                    threading.Thread(
                        target=tp_usb_protocol_client,
                        args=(serial,),
                        daemon=True
                    ).start()
                else:
                    print("[USB] TP USB forward olusturulamadi.")

            elif last:
                print("[USB] Tablet cikarildi.")
                TP_USB_STOP_EVENT.set()
                with TP_USB_LOCK:
                    if TP_USB_CONN:
                        TP_USB_CONN.close()
                        TP_USB_CONN=None
                # Clear stale forwarding rule if possible.
                tp_adb_run(
                    ["-P",str(TP_ADB_SERVER_PORT),
                     "forward","--remove","tcp:%d"%TP_USB_FORWARD_PORT],
                    timeout=3
                )
                TP_USB_STOP_EVENT.clear()

            last=serial

        time.sleep(1.5)



class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        print("[HTTP] " + fmt % args)

    def end_headers(self):
        # APK WebView is loaded from file:// and calls the PC bridge over HTTP.
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Requested-With")
        self.send_header("Access-Control-Max-Age", "600")
        super().end_headers()

    def json_response(self, obj, code=200):
        data = json.dumps(obj, separators=(",", ":")).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-cache, no-store")
        self.end_headers()
        self.wfile.write(data)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        u = urlparse(self.path)
        q = parse_qs(u.query)

        if u.path == "/bridge/connect":
            sid = q.get("sid", [None])[0]
            host = q.get("host", [MACRODECK_HOST])[0]
            if not sid:
                sid = uuid.uuid4().hex
            s = get_session(sid, host)
            self.json_response({
                "ok": True,
                "sid": sid,
                "connected": s.connected,
                "host": s.host,
                "port": MACRODECK_PORT
            })
            return

        if u.path == "/bridge/poll":
            sid = q.get("sid", [None])[0]
            host = q.get("host", [MACRODECK_HOST])[0]

            # The client may still have a saved SID after the bridge restarted.
            # Re-create the session instead of returning 404.
            if not sid:
                sid = uuid.uuid4().hex

            s = get_session(sid, host)

            # Long-poll for up to 15 seconds. The old 250 ms polling loop
            # caused ~4 GET requests/second even when nothing changed.
            deadline = time.time() + 15.0
            messages = []

            while time.time() < deadline:
                messages = s.pop()
                if messages:
                    break
                time.sleep(0.10)

            self.json_response({
                "ok": True,
                "connected": s.connected,
                "messages": messages
            })
            return

        if u.path == "/bridge/status":
            sid = q.get("sid", [None])[0]
            s = SESSIONS.get(sid)
            self.json_response({
                "ok": bool(s),
                "connected": bool(s and s.connected)
            })
            return

        # Static files are served by the same process so old browsers need
        # only one address: http://PC:8080/
        if u.path == "/" or u.path == "/index.html":
            return self.serve_file("index.html", "text/html; charset=utf-8")
        if u.path == "/client.js":
            return self.serve_file("client.js", "application/javascript; charset=utf-8")
        if u.path == "/style.css":
            return self.serve_file("style.css", "text/css; charset=utf-8")
        if u.path == "/icon.ico":
            return self.serve_file("icon.ico", "image/x-icon")

        self.send_response(404)
        self.end_headers()

    def serve_file(self, name, ctype):
        try:
            with open(name, "rb") as f:
                data = f.read()
            self.send_response(200)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-cache")
            self.end_headers()
            self.wfile.write(data)
        except IOError:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        u = urlparse(self.path)
        q = parse_qs(u.query)

        if u.path != "/bridge/send":
            self.json_response({"ok": False}, 404)
            return

        sid = q.get("sid", [None])[0]
        host = q.get("host", [MACRODECK_HOST])[0]
        if not sid:
            sid = uuid.uuid4().hex
        s = get_session(sid, host)

        try:
            n = int(self.headers.get("Content-Length", "0"))
            raw = self.rfile.read(n)
            obj = json.loads(raw.decode("utf-8"))
        except Exception:
            self.json_response({"ok": False}, 400)
            return

        ok = s.send(obj)
        self.json_response({"ok": ok, "sid": sid, "connected": s.connected})


class ThreadedHTTPServer(ThreadingMixIn, HTTPServer):
    daemon_threads = True


def main():
    global MACRODECK_HOST, MACRODECK_PORT

    if not first_launch_setup():
        return

    threading.Thread(target=tp_usb_forward_worker, daemon=True).start()

    print("TP Macro Deck HTTP/WebSocket Bridge")
    print("Web client:  http://<PC-IP>:%d/" % PORT)
    print("Macro Deck: ws://%s:%d/" % (MACRODECK_HOST, MACRODECK_PORT))
    print("")
    if websocket is None:
        print("UYARI: websocket-client kurulu degil.")
        print("Calistirmak icin: pip install websocket-client")
    server = ThreadedHTTPServer((HOST, PORT), Handler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
