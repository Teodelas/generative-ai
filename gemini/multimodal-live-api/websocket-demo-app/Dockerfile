FROM nginx:alpine

# install Python 3 and pip
RUN apk add --no-cache python3 py3-pip supervisor

# copy the front end 
COPY frontend/. /usr/share/nginx/html

# copy backend
COPY backend/. /app

# install supervisord
RUN pip3 install --no-cache-dir --break-system-packages -r app/requirements.txt
RUN pip3 install --break-system-packages requests

COPY supervisord.conf /etc/supervisor/supervisord.conf
COPY nginx.conf /etc/nginx/nginx.conf

EXPOSE 8000

CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/supervisord.conf"]