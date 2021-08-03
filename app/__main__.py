import sys

from gevent.pywsgi import WSGIServer
from geventwebsocket.handler import WebSocketHandler

from . import app

port = 8080


def main():
    try:
        # Run the app on specified port
        print("Listening on http://127.0.0.1:{}/".format(port))
        http_server = WSGIServer(('127.0.0.1', port), app, handler_class=WebSocketHandler)
        http_server.serve_forever()
    except KeyboardInterrupt:
        return 0

    return 1


if __name__ == "__main__":
    sys.exit(main())
