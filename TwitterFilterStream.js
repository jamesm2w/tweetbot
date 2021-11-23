const { json } = require("express");
const needle = require("needle");

const rulesURL = 'https://api.twitter.com/2/tweets/search/stream/rules';
const streamURL = 'https://api.twitter.com/2/tweets/search/stream?expansions=author_id&user.fields=name,username,profile_image_url,id&tweet.fields=author_id,id';
const token = process.env.BEARER_TOKEN;

const headers = {
    "User-Agent": "tweetbot/jamesm2w",
    "Authorization": `Bearer ${token}`,
    "Content-Type": "application/json"
}

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

            // Delete all rules from the filter.
            await this.deleteRules(currentRules);
            this.log("[RuleLoader] Cleared Rules");

            // Add new rules to the filter.
            await this.setRules(this.filterRules);

            // Check if rules have been applied correctly
            currentRules = await this.getCurrentRules();
            this.log("[RuleLoader] Final Stream Rules: " + JSON.stringify(currentRules));
        } catch (err) {
            // Promise Errors get thrown up here and we exit with error code.
            this.log("[RuleLoader] Error in setting up filter rules");
            console.log(JSON.stringify(err));            
            console.error(err);

            process.exit(1);
        }

        this.stream = this.streamConnect(0);

        setInterval(() => {
            let diff = (new Date()) - this.lastAlive;
            if (Math.floor(diff / 1000) > 5 * 60) {
                this.log("No Keep Alive for 5 minutes. Assuming we're disconnected silently. Quitting.");
                process.exit(1);
            }
        }, 5 * 60 * 1000)
    }

    setConnected (bool) {
        if (bool != this.connected) {
            this.log("Connected set to " + bool);
        }
        this.connected = bool;
    }

    // Connect to the twitter filtered stream. Attempt count - incrementing counter if conn refused
    streamConnect (attemptCount) {
        this.log("Connecting: Attempt Count " + attemptCount);
        // We need to stop trying at some point
        if (attemptCount > 4) {
            console.error("Too many attempts. Quitting.");
            
            process.exit(1);
        }

        // Initiate the stream
        const stream = needle.get(streamURL, {
            headers: headers,
            timeout: 20000,
            json: true,
            parse_response: true,
            output: "./latestnet.txt"
        });

        // Callback on certain events - rawData = stuff recv from twitter.
        stream.on("data", rawData => {
            //console.log("raw data", rawData);

            if (rawData.title !== undefined) {
                this.log("Connection Issue - " + rawData.title + ": " + rawData.detail);
                return;
            }

            //if (Array.isArray(rawData.errors)) {
            //    for (let err of data.errors) {
            //        this.log("Stream Error - " + err.title + ": " + err.detail);
            //    }
            //    return;
            //}

            if (rawData == "\r\n") {
                this.lastAlive = new Date();
            } else {
                const data = JSON.parse(rawData);

                if (Array.isArray(data.errors)) {
                    for (let err of data.errors) {
                        this.log("Stream Error - " + err.title + ": " + err.detail);
                    }
                    return;
                }
                //console.log("parsed data", data);

                setTimeout(() => {
                    this.onDataFunction.call({}, data);
                }, 0);
                
            }

            this.setConnected(true);
            attemptCount = 0;        
        });

        stream.on("err", err => {
            this.log("error event", err);
            console.error(err);
        });

        // done - stream finished with possible error
        stream.on("done", error => {
            if (error) {
                this.log("Stream Done with error", error);
                console.error(error);
            }
            this.log("Stream Done and closed.");
            this.setConnected(false);
            setTimeout(() => {
                this.log("Reconnecting...");
                this.streamConnect(attemptCount++);
            }, 100 * (5 ** (attemptCount++)));
        });

        return stream;
    }

    async getCurrentRules () {
        let response = await needle("GET", rulesURL, {}, {
            headers: headers
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
            headers: headers
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
            headers: headers
        })
    
        if (response.statusCode !== 201 && response.statusCode !== 200) {
            this.log("[Set Rules] Err: " + response.statusCode + " " + response.statusMessage);
            throw new Error(JSON.stringify(response.body));
        }
    
        return response.body;
    }

    log (msg) {
        let date = (new Date()).toLocaleString("en-GB");
        console.log("[" + date + "][TwitterFilterStream] " + msg);
    }
}

module.exports = TwitterFilterStream;
