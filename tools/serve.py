# A local web server for trying the app and running the tests (python tools/serve.py 8000 .).
# Like "python -m http.server", but the browser is told not to keep copies, so every
# reload gets the files as they are now, and .js files are served as JavaScript.
import functools, http.server, sys


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, '.js': 'text/javascript', '.mjs': 'text/javascript'}

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()


port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
root = sys.argv[2] if len(sys.argv) > 2 else '.'
print(f'Serving {root} at http://localhost:{port}/')
http.server.ThreadingHTTPServer(('127.0.0.1', port), functools.partial(Handler, directory=root)).serve_forever()
