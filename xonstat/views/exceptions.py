import logging
import random

def notfound(request):
    request.response.status = 404
    return {'rand': int(random.random() * 100)}

def unauthorized(request):
    request.response.status = 401
    return {'requestUrl': request.url }
