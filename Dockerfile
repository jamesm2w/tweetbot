# specify the node base image with your desired version node:<version>
FROM node:14
# replace this with your application's default port
EXPOSE 8888

COPY . .

RUN npm install

CMD ["npm", "start"]