require("dotenv").config();

const http = require("http");
const needle = require("needle");
const token = process.env.BEARER_TOKEN;

const webhook = "https://discord.com/api/webhooks/869954788157194342/VGTzrt0xi5uJ5Wduhet5UDBu1IWnB6ewvl4vOlCmiMDicj-BFmQUGNoJG0dv_75sFfJZ";

const rulesURL = 'https://api.twitter.com/2/tweets/search/stream/rules';
const streamURL = 'https://api.twitter.com/2/tweets/search/stream?expansions=author_id&user.fields=name,username,profile_image_url,id&tweet.fields=author_id,id';

const rules = [{
    "value": "from:BritainElects OR from:PoliticsForAlI",
    "tag": "from interested accounts"
}];

let lastAlive = new Date();

function log (msg) {
    let date = (new Date()).toUTCString();
    console.log(date + "] " + msg);
}

async function getCurrentRules () {
    let response = await needle("GET", rulesURL, {}, {
        headers: {
            "Authorization": `Bearer ${token}`
        }
    });

    if (response.statusCode !== 200) {
        log("[Get current rules] Err: " + response.statusCode + " " + response.statusMessage);
        throw new Error(response.body);
    }

    return response.body;
}

async function deleteAllRules (ruleArr) {
    if (!Array.isArray(ruleArr)) {
        return null;
    }

    let ids = ruleArr.data.map(rule => rule.id);

    let data = {
        "delete": {
            "ids": ids
        }
    };

    let response = await needle("POST", rulesURL, data, {
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`
        }
    });

    if (response.statusCode !== 200) {
        log("[Delete rules] Err: " + response.statusCode + " " + response.statusMessage);
        throw new Error(response.body);
    }

    return response.body;
}

async function setRules () {
    let data = {
        "add": rules
    };

    let response = await needle('POST', rulesURL, data, {
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`
        }
    })

    if (response.statusCode !== 201) {
        log("[Set rules] Err: " + response.statusCode + " " + response.statusMessage);
        throw new Error(response.body);
    }

    return response.body;
}

function twitterStreamConnect (retryAttempt) {
    const stream = needle.get(streamURL, {
        headers: {
            "User-Agent": "v2FilterStreamTEST",
            "Authorization": `Bearer ${token}`
        },
        timeout: 20000
    });
    
    stream.on("data", async data => {
        try {
            const json = JSON.parse(data);

            console.log(json);

            // Construct webhook payload data. Find the user which tweeted in the `include` section
            // Construct url from base + tweet ID
            let userData = json.includes.users.find(usr => usr.id == json.data.author_id) || {};
            let url = "https://twitter.com/i/status/" + json.data.id;

            // Provide some fallbacks just in-case data from twitter is not available.
            let hookLoad = {
                "username": userData.name || "Twitter Bot",
                "avatar_url": userData.profile_image_url || "", 
                "content": url || "Webhook Error"
            };
            
            // Send discord webhook
            let response = await needle("POST", webhook, hookLoad);

            // Discord responds with 204 No Content when successful.
            if (response.statusCode !== 204) {
                log("[Discord Webhook] unexpected code: " + response.statusCode + " " + response.statusMessage);
                throw new Error(response.body);
            } else {
                log("Recieved New Tweet: " + url);
            }

            // Successful connection => reset retry counter
            retryAttempt = 0;
        } catch (e) {
            if (data.detail === "This stream is currently at the maximum allowed connection limit.") {
                // Twitter stream limit - maybe previous connection has not wrapped up?
                // Kill signal
                log("[Stream] Twitter Connection Refused");
                log(data.detail);
                process.exit(1);
            } else {
                // Keep alive signal
                log("[Stream] Keep Alive from Twitter");
                lastAlive = new Date();
            }
        }
    }).on('err', error => {
        log("[Stream] Error connecting to twitter stream");
        if (error.code !== 'ECONNRESET') {
            // Some other connection error
            log(error.code);
            process.exit(1);
        } else {
            // This reconnection logic will attempt to reconnect when a disconnection is detected.
            // To avoid rate limits, this logic implements exponential backoff, so the wait time
            // will increase if the client cannot reconnect to the stream. 
            setTimeout(() => {
                console.warn("[Stream] A connection error occurred. Reconnecting...")
                streamConnect(++retryAttempt);
            }, 2 ** retryAttempt)
        }
    });

    return stream;
}

(async () => {
    let currentRules;

    // Set up the rules for the filtered stream
    try {
        // Gets the complete list of rules currently applied to the stream
        currentRules = await getCurrentRules();

        // Delete all rules. Comment the line below if you want to keep your existing rules.
        await deleteAllRules(currentRules);

        // Add rules to the stream. Comment the line below if you don't want to add new rules.
        await setRules();

    } catch (e) {
        console.error(e);
        process.exit(1);
    }

    log("Establishing connection with Twitter Feed");

    // Listen to the stream.
    twitterStreamConnect(0);

    http.createServer((req, res) => {
        res.writeHead(200);
        res.end("TweetBot Active and Listening. Last Alive: " + lastAlive.toUTCString());
    }).listen(8888);
})();