# tweetbot

Posts tweets from twitter accounts to a discord channel.

Connects to a twitter filtered stream and sends tweets from listed accounts to a discord channel or thead using a webhook URL.

## Configuration

Can either run by docker or through node

### Node
Requires a .env file in project root with the following parameters:
(N.B. delete comments and whitespace around "=" symbol)
```
API_KEY= // Twitter application API key
API_SECRET= // Twitter application API secret
BEARER_TOKEN= // Twitter application token (used for authentication with twitter)
CONNECTIONSTRING= // Connection string for a MongoDB
PORT= // Application port for the status webserver
```

To run Node silently with logging:

`node index.js > latestlog 2>latesterr &`

### Docker
Docker compose configuration includes use of a MongoDB and defaults to port 8888 for the application
However it still requires a .env file in project root with the following parameters:
(N.B. delete comments and whitespace around "=" symbol)
```
API_KEY= // Twitter application API key
API_SECRET= // Twitter application API secret
BEARER_TOKEN= // Twitter application token (used for authentication with twitter)
```

## Dependencies

Dependencies can be installed with 
`npm install`

* dotenv
* express
* mongodb
* needle

## License
Licensed under [GPL v3.0](https://www.gnu.org/licenses/gpl-3.0.en.html) or later.