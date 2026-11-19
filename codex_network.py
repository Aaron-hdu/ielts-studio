"""Choose a reachable ChatGPT address when local DNS returns a mixture of routes."""
import concurrent.futures
import contextlib
import os
import select
import socket
import socketserver
import subprocess
import threading
import urllib.request


HOST = "chatgpt.com"


def reachable(address):
    try:
        with socket.create_connection((address, 443), timeout=3):
            return True
    except OSError:
        return False


class ChatGPTConnection(socketserver.StreamRequestHandler):
    def handle(self):
        self.connection.settimeout(10)
        request = self.rfile.readline(2048).split()
        if len(request) != 3 or request[:2] != [b"CONNECT", b"chatgpt.com:443"]:
            self.wfile.write(b"HTTP/1.1 403 Forbidden\r\n\r\n")
            return
        for _ in range(64):
            line = self.rfile.readline(8192)
            if line == b"\r\n":
                break
            if not line or len(line) >= 8192:
                return
        else:
            return

        for address in self.server.addresses:
            try:
                upstream = socket.create_connection((address, 443), timeout=4)
                break
            except OSError:
                continue
        else:
            self.wfile.write(b"HTTP/1.1 502 Bad Gateway\r\n\r\n")
            return

        with upstream:
            self.wfile.write(b"HTTP/1.1 200 Connection Established\r\n\r\n")
            peers = {upstream: self.connection, self.connection: upstream}
            while True:
                ready, _, _ = select.select(list(peers), [], [], 360)
                if not ready:
                    return
                for source in ready:
                    data = source.recv(65536)
                    if not data:
                        return
                    peers[source].sendall(data)


class LocalRelay(socketserver.ThreadingTCPServer):
    daemon_threads = True

    def handle_error(self, request, client_address):
        # Client cancellation and upstream disconnects close the tunnel.
        pass


@contextlib.contextmanager
def connection_environment(binary):
    proxies = urllib.request.getproxies()
    if (any(key in proxies for key in ("http", "https", "all", "socks")) or
            urllib.request.proxy_bypass(HOST) or os.environ.get("OPENAI_BASE_URL")):
        yield None
        return
    try:
        addresses = list(dict.fromkeys(record[4][0] for record in
                              socket.getaddrinfo(HOST, 443, type=socket.SOCK_STREAM)))
        good = []
        if len(addresses) > 1:
            with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
                good = [ip for ip, ok in zip(addresses, pool.map(reachable, addresses)) if ok]
        split_route = 0 < len(good) < len(addresses)
        if split_route:
            login = subprocess.run([binary, "login", "status"], capture_output=True, timeout=5)
            split_route = login.returncode == 0 and b"using ChatGPT" in login.stdout + login.stderr
        relay = LocalRelay(("127.0.0.1", 0), ChatGPTConnection) if split_route else None
    except (OSError, subprocess.TimeoutExpired):
        relay = None
    if relay is None:
        yield None
        return
    with relay:
        relay.addresses = good
        worker = threading.Thread(target=relay.serve_forever, daemon=True)
        worker.start()
        try:
            yield dict(os.environ, HTTPS_PROXY="http://127.0.0.1:" + str(relay.server_address[1]))
        finally:
            relay.shutdown()
            worker.join()
