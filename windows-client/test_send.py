import socket, json, time
s=socket.create_connection(("127.0.0.1",18765),3)
print(s.recv(1024).decode().strip())
msg={"Method":"BUTTON_PRESS","Message":"0_0","Client-Id":"TP_TEST"}
s.sendall((json.dumps(msg,separators=(",",":"))+"\\n").encode())
print("BUTTON_PRESS gonderildi")
time.sleep(2)
s.close()
