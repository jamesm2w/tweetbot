require("dotenv").config();

const needle = require("needle");
const token = process.env.BEARER_TOKEN;

const webhook = "https://discord.com/api/webhooks/869954788157194342/VGTzrt0xi5uJ5Wduhet5UDBu1IWnB6ewvl4vOlCmiMDicj-BFmQUGNoJG0dv_75sFfJZ";

const rulesURL = 'https://api.twitter.com/2/tweets/search/stream/rules';
const streamURL = 'https://api.twitter.com/2/tweets/search/stream?expansions=author_id&user.fields=name,username,profile_image_url';

const rules = [{
    "value": "from:BritainElects OR from:PoliticsForAlI",
    "tag": "from interested accounts"
}];

async function getCurrentRules () {
    let response = await needle("GET", rulesURL, {}, {
        headers: {
            "Authorization": `Bearer ${token}`
        }
    });

    if (response.statusCode !== 200) {
        console.log("Error: ", response.statusMessage, response.statusCode);
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
        throw new Error(response.body);
    }

    return response.body;
}

async function setRules () {
    let data = {
        "add": rules
    };

    let response = await needle('post', rulesURL, data, {
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`
        }
    })

    if (response.statusCode !== 201) {
        throw new Error(response.body);
    }

    return response.body;
}

function twitterStreamConnect (retryAttempt, onSuccess) {
    const stream = needle.get(streamURL, {
        headers: {
            "User-Agent": "v2FilterStreamTEST",
            "Authorization": `Bearer ${token}`
        },
        timeout: 20000
    });
    
    stream.on("data", data => {
        try {
            const json = JSON.parse(data);

            // send a discord webhook or something?
            onSuccess(json);
            // Successful connection => reset retry counter
            retryAttempt = 0;
        } catch (e) {
            if (data.detail === "This stream is currently at the maximum allowed connection limit.") {
                // Kill signal
                console.log(data.detail);
                process.exit(1);
            } else {
                // Keep alive signal
            }
        }
    }).on('err', error => {
        console.log("Error connecting to twitter stream");
        if (error.code !== 'ECONNRESET') {
            // Some other connection error
            console.log(error.code);
            process.exit(1);
        } else {
            // This reconnection logic will attempt to reconnect when a disconnection is detected.
            // To avoid rate limits, this logic implements exponential backoff, so the wait time
            // will increase if the client cannot reconnect to the stream. 
            setTimeout(() => {
                console.warn("A connection error occurred. Reconnecting...")
                streamConnect(++retryAttempt);
            }, 2 ** retryAttempt)
        }
    });

    return stream;
}

(async () => {
    let currentRules;

    try {

        // Gets the complete list of rules currently applied to the stream
        currentRules = await getCurrentRules();

        // Delete all rules. Comment the line below if you want to keep your existing rules.
        await deleteAllRules(currentRules);

        // Add rules to the stream. Comment the line below if you don't want to add new rules.
        await setRules();

    } catch (e) {
        console.log(JSON.stringify(e));
        console.error(e);
        process.exit(1);
    }
    console.log("Establishing connection with Twitter Feed");
    // Listen to the stream.
    twitterStreamConnect(0, (json) => {
        if (json.data?.id != undefined) {

            let hookLoad = {
                "username": json.includes?.name || "Twitter Bot",
                "avatar_url": json.includes?.profile_image_url || "", 
                "content": url
            };

            let url = "https://twitter.com/i/status/" + json.data.id;
            needle.post(webhook, hookLoad, (err, res) => {
                if (err) {
                    throw new Error(err);
                }

                // WE're all good.
                console.log("Recieved new Tweet :", url);
            });
        } else {
            console.log(json);
        }
    });
})();