from gevent import monkey
monkey.patch_all()

import random
import string

from flask import Flask, request, abort, render_template

from .message import Message


app = Flask(__name__)
rooms = {}


def random_id(length=6):
    return ''.join(random.choice(string.ascii_lowercase + string.digits) for _ in range(length))


def websocket():
    return request.environ.get('wsgi.websocket')


@app.route('/')
def index():
    return render_template('visio.html')


@app.route('/room/<room_id>')
def room(room_id):
    global rooms

    print("Incoming client")

    ws = websocket()
    if ws is None:
        return '', 426  # Upgrade Required

    room = rooms.setdefault(room_id, {})
    while True:
        client_id = random_id(6)
        if client_id not in room:
            break

    room[client_id] = ws

    print("Room {}: Client {} joined".format(room_id, client_id))

    try:
        ws.send(str(Message(client_id, "register")))

        for dest_id, dest_ws in room.items():
            if dest_id != client_id:
                try:
                    dest_ws.send(str(Message(client_id, "join")))
                except Exception as e:
                    print(e)

        while True:
            data = ws.receive()
            if data is None:
                break

            message = Message.parse(data)

            print("Room {}: Client {} > {}: {}".format(room_id, client_id, message.id, data))

            dest_ws = room.get(message.id)
            if dest_ws is None:
                ws.send(str(Message(client_id, "error", ["not_found"])))
                continue

            message.id = client_id
            try:
                dest_ws.send(str(message))
            except Exception as e:
                print(e)
                ws.send(str(Message(client_id, "error", ["not_connected"])))

    except Exception as e:
        print(e)
        abort(500)  # Internal Server Error

    finally:
        print("Room {}: Client {} left".format(room_id, client_id))
        del room[client_id]

        for dest_id, dest_ws in room.items():
            try:
                dest_ws.send(str(Message(client_id, "leave")))
            except Exception as e:
                print(e)

        if len(room) == 0:
            del rooms[room_id]

    return ''


# Import main to expose it outside
from .__main__ import main
