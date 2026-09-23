import socket, json, time
s=socket.create_connection(("127.0.0.1",18765),3)
msg={"type":"test","message":"hello","time":time.time()}
s.sendall((json.dumps(msg,separators=(",",":"))+"\n").encode("utf-8"))
print("TEST PAKETI GONDERILDI")
s.close()
