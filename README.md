# MyLittleVisio - Minimalist Web Videoconference

MyLittleVisio is a minimalist web videoconference service using WebRTC.

The service should be run in a virtual environment where dependencies are installed:
```
$ virtualenv env
$ source env/bin/activate
$ pip install -r requirements.txt
$ ./run.py
```

You can now open the interface on `http://localhost:8080/`, which will create a new session. Opening the same session URL in another window allows to join the session.

