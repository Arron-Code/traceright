import http.server
import mimetypes


mimetypes.add_type("application/javascript", ".mjs")
http.server.test(
    HandlerClass=http.server.SimpleHTTPRequestHandler,
    port=4173,
)
