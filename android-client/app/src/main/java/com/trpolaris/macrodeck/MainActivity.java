package com.trpolaris.macrodeck;

import android.app.Activity;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.BufferedReader;
import java.io.BufferedWriter;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;

public class MainActivity extends Activity {
    private WebView webView;
    private UsbBridge usbBridge;
    private WebAppBridge webAppBridge;

    @Override
    public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN,
                WindowManager.LayoutParams.FLAG_FULLSCREEN);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        webView = new WebView(this);
        setContentView(webView);

        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(true);
        s.setAllowContentAccess(true);
        s.setBuiltInZoomControls(false);
        s.setSupportZoom(false);

        webView.setWebViewClient(new WebViewClient());
        webView.setBackgroundColor(0xff111111);

        webAppBridge = new WebAppBridge();
        webView.addJavascriptInterface(webAppBridge, "TPNative");

        usbBridge = new UsbBridge(webAppBridge);
        usbBridge.start();

        webView.loadUrl("file:///android_asset/index.html");
    }

    private void hideUi() {
        getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_FULLSCREEN |
                View.SYSTEM_UI_FLAG_HIDE_NAVIGATION |
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY |
                View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN |
                View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION |
                View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
    }

    @Override public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideUi();
    }

    @Override protected void onDestroy() {
        if (usbBridge != null) usbBridge.stop();
        super.onDestroy();
    }

    @Override public void onBackPressed() {}

    private static class UsbBridge {
        private static final int PORT = 8765;
        private volatile boolean running;
        private ServerSocket server;
        private volatile Socket client;
        private volatile BufferedWriter writer;
        private final WebAppBridge web;

        UsbBridge(WebAppBridge web) {
            this.web = web;
            web.nativeBridge = this;
        }

        void start() {
            if (running) return;
            running = true;

            new Thread(new Runnable() {
                @Override public void run() {
                    try {
                        server = new ServerSocket(
                                PORT,
                                4,
                                InetAddress.getByName("127.0.0.1"));
                        web.setNativeStatus("USB_SERVER_READY");

                        while (running) {
                            Socket s = server.accept();
                            try { s.setTcpNoDelay(true); } catch (Exception ignored) {}
                            synchronized (UsbBridge.this) {
                                closeClientLocked();
                                client = s;
                                writer = new BufferedWriter(
                                        new OutputStreamWriter(
                                                s.getOutputStream(), "UTF-8"));
                            }

                            sendLocked("TP_READY");

                            readLoop(s);
                        }
                    } catch (Throwable t) {
                        web.setNativeStatus("USB_SERVER_ERROR:" + t.toString());
                    } finally {
                        synchronized (UsbBridge.this) {
                            closeClientLocked();
                        }
                    }
                }
            }, "TP_USB_Server").start();
        }

        private void readLoop(Socket expected) {
            BufferedReader reader = null;
            try {
                reader = new BufferedReader(
                        new InputStreamReader(
                                expected.getInputStream(), "UTF-8"));

                String line;
                while (running && expected == client &&
                        (line = reader.readLine()) != null) {

                    line = line.trim();
                    if (line.length() == 0) continue;

                    if ("TP_PING".equals(line)) {
                        send("TP_PONG");
                        continue;
                    }

                    web.onNativeMessage(line);
                }
            } catch (Throwable t) {
                web.setNativeStatus("USB_SOCKET_ERROR:" + t.toString());
            } finally {
                synchronized (this) {
                    if (client == expected) closeClientLocked();
                }
            }
        }

        synchronized private void sendLocked(String line) {
            try {
                if (writer == null) return;
                writer.write(line);
                writer.newLine();
                writer.flush();
            } catch (Throwable ignored) {}
        }

        synchronized void send(String line) {
            sendLocked(line);
        }

        synchronized boolean isConnected() {
            return running && client != null && !client.isClosed()
                    && client.isConnected() && writer != null;
        }

        synchronized void disconnectClient() {
            closeClientLocked();
        }

        synchronized private void closeClientLocked() {
            try { if (client != null) client.close(); } catch (Throwable ignored) {}
            client = null;
            writer = null;
        }

        synchronized void stop() {
            running = false;
            closeClientLocked();
            try { if (server != null) server.close(); } catch (Throwable ignored) {}
            server = null;
        }
    }

    private class WebAppBridge {
        private UsbBridge nativeBridge;

        @JavascriptInterface
        public boolean isUsbConnected() {
            return nativeBridge != null && nativeBridge.isConnected();
        }

        @JavascriptInterface
        public void disconnectUsb() {
            if (nativeBridge != null) {
                nativeBridge.disconnectClient();
            }
        }

        @JavascriptInterface
        public void send(String json) {
            if (nativeBridge != null) {
                nativeBridge.send(json);
            }
        }

        @JavascriptInterface
        public String status() {
            return "NATIVE";
        }

        void setNativeStatus(final String text) {
            if (webView == null) return;
            runOnUiThread(new Runnable() {
                @Override public void run() {
                    String safe = text.replace("\\", "\\\\")
                            .replace("'", "\\'");
                    webView.loadUrl(
                            "javascript:window.TPNativeStatus && TPNativeStatus('" +
                                    safe + "')");
                }
            });
        }

        void onNativeMessage(final String text) {
            if (webView == null) return;
            runOnUiThread(new Runnable() {
                @Override public void run() {
                    String safe = text.replace("\\", "\\\\")
                            .replace("'", "\\'");
                    webView.loadUrl(
                            "javascript:window.TPUsbReceive && TPUsbReceive('" +
                                    safe + "')");
                }
            });
        }
    }
}
