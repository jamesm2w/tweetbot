const { json } = require("express");
const needle = require("needle");

const rulesURL = 'https://api.twitter.com/2/tweets/search/stream/rules';
const streamURL = 'https://api.twitter.com/2/tweets/search/stream?expansions=author_id&user.fields=name,username,profile_image_url,id&tweet.fields=author_id,id';
const token = process.env.BEARER_TOKEN;

class TwitterFilterStream {

    constructor (onDataFunction, filterRules) {
        this.onDataFunction = onDataFunction;
        this.filterRules = filterRules;
        this.lastAlive = undefined;

        this.stream = undefined;
        this.connected = false;
    }

    async connect () {
        this.log("Attempting to connect to twitter stream.")
        try {

            this.log("[RuleLoader] Loaded rules: " + JSON.stringify(this.filterRules));

            // Gets the complete list of rules currently applied to the stream
            let currentRules = await this.getCurrentRules();
            this.log("[RuleLoader] Current Stream Rules: " + JSON.stringify(currentRules));

            // Delete all rules. Comment the line below if you want to keep your existing rules.
            await this.deleteRules(currentRules);
            this.log("[RuleLoader] Cleared Rules");

            // Add rules to the stream. Comment the line below if you don't want to add new rules.
            await this.setRules(this.filterRules);

            // Check if rules have been applied correctly
            this.log("[RuleLoader] Final Stream Rules: " + JSON.stringify(await this.getCurrentRules()));
        } catch (err) {
            // Promise Errors get thrown up here and it exits with non-0 code.
            console.error(err);
            console.log(JSON.stringify(err));
            process.exit(1);
        }

        this.stream = this.twitterStreamConnect(0);
    }

    setConnected (state) {
        this.log("Connected State Changed to " + state);
        this.connected = state;
    }

    destroyStream () {
        if (this.connected && this.stream != undefined) {
            this.stream.destroy();
            this.setConnected(false);
        }
    }

    twitterStreamConnect (retryAttempt) {
        const stream = needle.get(streamURL, {
            headers: {
                "User-Agent": "tweetbotFilterStream",
                "Authorization": `Bearer ${token}`
            },
            timeout: 20000
        });
        
        stream.on("data", async data => {
            try {
                const json = JSON.parse(data);

                if (Array.isArray(json.errors)) {
                    // Some sort of error?
                    throw new Error(json);
                }

                this.onDataFunction(json);

                // Successful connection => reset retry counter
                retryAttempt = 0;
            } catch (e) {
                if (Array.isArray(e.errors)) {
                    // Some error from Twitter
                    for (let err of e.errors) {
                        this.log("[Stream][Err] " + JSON.stringify(err));
                        console.err(err);    
                    }
                    //this.setConnected(false);

                    // setTimeout(() => {
                    //    console.warn("[Stream] An error occurred. Reconnecting...")
                    //    twitterStreamConnect(++retryAttempt);
                    // }, 2 ** retryAttempt);

                } else if (data.detail === "This stream is currently at the maximum allowed connection limit.") {
                    // Twitter stream limit - maybe previous connection has not wrapped up?
                    // Kill signal
                    this.log("[Stream] Twitter Connection Refused");
                    this.log(data.detail);
                    setTimeout(() => {
                        console.warn("[Stream] A connection error occurred. Reconnecting...")
                        twitterStreamConnect(++retryAttempt);
                    }, 2 ** retryAttempt);
                } else {
                    // Keep alive signal
                    //this.log("[Stream] Keep Alive from Twitter");
                    this.lastAlive = new Date();

                    if (!this.connected) {
                        this.setConnected(true);
                    }
                }
            }
        }).on('err', error => {
            this.log("[Stream] Error connecting to twitter stream");
            if (error.code !== 'ECONNRESET') {
                // Some other connection error
                this.log(error.code);
                process.exit(1);
            } else {
                // This reconnection logic will attempt to reconnect when a disconnection is detected.
                // To avoid rate limits, this logic implements exponential backoff, so the wait time
                // will increase if the client cannot reconnect to the stream. 
                setTimeout(() => {
                    console.warn("[Stream] A connection error occurred. Reconnecting...")
                    twitterStreamConnect(++retryAttempt);
                }, 2 ** retryAttempt);
            }
        });
    
        return stream;
    }

    async getCurrentRules () {
        let response = await needle("GET", rulesURL, {}, {
            headers: {
                "Authorization": `Bearer ${token}`
            }
        });
    
        if (response.statusCode !== 200) {
            this.log("[Get Rules] Err: " + response.statusCode + " " + response.statusMessage);
            throw new Error(response.body);
        }
    
        return response.body;
    }

    async deleteRules (ruleArr) {

        if (!Array.isArray(ruleArr.data)) {
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
            this.log("[Delete Rules] Err: " + response.statusCode + " " + response.statusMessage);
            throw new Error(response.body);
        }
    
        return response.body;
    }

    async setRules (rules) {
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
            this.log("[Set Rules] Err: " + response.statusCode + " " + response.statusMessage);
            throw new Error(response.body);
        }
    
        return response.body;
    }

    log (msg) {
        let date = (new Date()).toLocaleString("en-GB");
        console.log("[" + date + "][TwitterFilterStream] " + msg);
    }
}

module.exports = TwitterFilterStream;
