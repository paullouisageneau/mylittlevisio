
class Message:
    def __init__(self, _id, _type, params=[], body=""):
        self.id = _id
        self.type = _type
        self.params = params
        self.body = body

    def __str__(self):
        header = " ".join([self.id, self.type] + self.params)
        return header + "\n" + (self.body if self.body else "")

    @staticmethod
    def parse(string):
        lines = string.split("\n")
        header = lines.pop(0)
        body = "\n".join(lines)
        params = header.split(" ")
        id = params.pop(0)
        type = params.pop(0)
        return Message(id, type, params, body)
