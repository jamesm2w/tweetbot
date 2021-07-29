require("dotenv").config();
const { MongoClient } = require('mongodb');
const http = require("http");
const needle = require("needle");

const token = process.env.BEARER_TOKEN;
const dbClient = new MongoClient(process.env.CONNECTIONSTRING);
const dbName = "tweetbot";

//no i wont const webhook = "webhook";

const rulesURL = 'https://api.twitter.com/2/tweets/search/stream/rules';
const streamURL = 'https://api.twitter.com/2/tweets/search/stream?expansions=author_id&user.fields=name,username,profile_image_url,id&tweet.fields=author_id,id';

let lastAlive = new Date();

function log (msg) {
    let date = (new Date()).toLocaleString("en-GB");
    console.log("[" + date + "] " + msg);
}

// Fetch current rules from twitter
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

// Delete all the given rules from twitter stream
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

// Set the given rules on the twitter filter stream
async function setRules (rules) {
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

// Connect to twitter stream and start listening to data
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
            
            // If tweet matched any rules lets send it to those webhooks.
            for (let rule of json.matching_rules) {
                // Send discord webhook
                let response = await needle("POST", rule.tag, hookLoad);

                // Discord responds with 204 No Content when successful.
                if (response.statusCode !== 204) {
                    log("[Discord Webhook] unexpected code: " + response.statusCode + " " + response.statusMessage);
                    throw new Error(response.body);
                } else {
                    log("Recieved New Tweet: " + url);
                }
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
    //let rules = [{
    //    "value": "from:BritainElects OR from:PoliticsForAlI",
    //    "tag": "webhook"
    //}];

    await dbClient.connect();

    log("Connected to MongoDB");

    const db = dbClient.db(dbName);
    const collection = db.collection("rules");

    let rules1 = (await collection.find({}).toArray()).map(r => { return {"value": r.value, "tag": r.tag} });
    log("Loaded rules: " + JSON.stringify(rules1));

    // Set up the rules for the filtered stream
    try {
        // Gets the complete list of rules currently applied to the stream
        let currentRules = await getCurrentRules();

        // Delete all rules. Comment the line below if you want to keep your existing rules.
        await deleteAllRules(currentRules);

        // Add rules to the stream. Comment the line below if you don't want to add new rules.
        await setRules(rules1);

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