# syntax=docker/dockerfile:1

# latest node version
FROM node:14

# port to use
EXPOSE 8888

# set /app as the working dir for the following commands
WORKDIR /app

# copy main config files
COPY ["package.json", "package-lock.json*", "./"]

# install modules
RUN npm install

# copy files into image
COPY . .

# start the app
CMD ["npm", "start"]