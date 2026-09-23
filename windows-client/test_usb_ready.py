import socket
s=socket.create_connection(("127.0.0.1",18765),3)
data=b""
while not data.endswith(b"\n"):
    p=s.recv(1024)
    if not p: break
    data+=p
print("Android:",data.decode().strip())
s.close()
