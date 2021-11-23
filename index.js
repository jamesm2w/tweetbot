require("dotenv").config();

const { MongoClient } = require("mongodb");
const TwitterFilterStream = require("./TwitterFilterStream.js");
const express = require("express");
const needle = require("needle");

const dbClient = new MongoClient(process.env.CONNECTIONSTRING);
const dbName = "tweetbot";
const app = express();

app.use(express.json());

let listeningHooks = {};

function log (msg) {
    let date = (new Date()).toLocaleString("en-GB");
    console.log("[" + date + "][Index] " + msg);
}

async function sendWebhookData (json) {
    // Construct webhook payload data. Find the user which tweeted in the `include` section
    // Construct url from base + tweet ID
    let userData = {
        username: "i",
        name: "TweetBot",
        profile_image_url: "https://image.flaticon.com/icons/png/512/124/124021.png"
    };

    if (json.includes == undefined || !Array.isArray(json.includes.users)) {
        log("Missing user data on tweet");
        console.log(json);
    } else {
        userData = json.includes.users.find(usr => usr.id == json.data.author_id) || {};
    }

    let url = `https://twitter.com/${userData.username}/status/${json.data.id}`;

    if (userData.username.toLowerCase() == "PoliticsForAlI".toLowerCase() && (
        json.data.text.toLowerCase().includes("crypto") || json.data.text.toLowerCase().includes("gambling") )) {
            console.log("Crypto/Gambling tweet");
            url = "Uh oh. Looks like PfA tried to post about crypto or gambling again. Please do better Mr PfA. \n ||" + url + "||";
    }
    
    // Provide some fallbacks just in-case data from twitter is not available.
    let hookLoad = {
        "username": userData.name || "Twitter Bot",
        "avatar_url": userData.profile_image_url || "", 
        "content": url || "Webhook Error"
    };
    
    // If tweet matched any rules lets send it to those webhooks.
    for (let hook of listeningHooks[userData.username]) {
        // Send discord webhook
        let response = await needle("POST", hook, hookLoad);

        // Discord responds with 204 No Content when successful.
        if (response.statusCode !== 204) {
            log("[Discord Webhook] unexpected code: " + response.statusCode + " " + response.statusMessage);
            throw new Error(response.body);
        } else {
            log("[Discord Webhook] Sent New Message: " + url);
        }
    }
}

function createRuleSet (channels) {
    let accounts = [];
    // Loop through every listening channel
    for (let channel of channels) {
        // Loop through every account it listens to
        for (let account of channel.accounts) {
            // If the account is not a duplicate
            if (!accounts.includes(account)) {
                // Add account to the list of accounts and 
                // add an association of the account name to the hook
                accounts.push(account);
                listeningHooks[account] = [channel.webhook];
            } else {
                // Else if it's a duplicate - just add the webhook to the association.
                listeningHooks[account].push(channel.webhook);
            }
        }
    }

    // Build a list of rules
    let rules = [];
    let ruleStr = "";
    // For every individual account to listen to
    for (let account of accounts) {
        // Add a from: operator to the rule string
        let ruleStrAddition = `from:${account}`;
        // If rule is not empty need to prepend the "OR" operator
        if (ruleStr.length != 0) {
            ruleStrAddition = " OR " + ruleStrAddition;
        }
        // Rules can be up to 512 in length. If adding this account would be 
        // over, add the current rule and start on the next one.
        if (ruleStr.length + ruleStrAddition.length > 512) {
            // Add to next rule, removing the prepended " OR "
            rules.push({"value": ruleStr.substring(4), "tag": `Rule ${rules.length+1}`});
            ruleStr = ruleStrAddition;
        } else {
            // Concat rules together
            ruleStr += ruleStrAddition;
        }
    }

    // Add remainder of the accounts to the final rule
    if (ruleStr.length != 0) {
        rules.push({"value": ruleStr, "tag": `Rule ${rules.length+1}`});
    }

    // There can be a maximum of 25 rules on one stream - if we have more than 25 rules ignore overflow
    // TODO: maybe make something better here.
    if (rules.length > 25) {
        log("[RuleConstructor] Error! Too Many Rules. Only applying first 25 rules");
        rules = rules.slice(0, 24);
    }

    return rules;
}

async function run () {
    try {
        await dbClient.connect();

        log("Connected to MongoDB");

        const db = dbClient.db(dbName);
        const channelCollection = db.collection("channels"); 

        let channels = await channelCollection.find({}).toArray();
        let rules = createRuleSet(channels);

        let twitterManager = new TwitterFilterStream(sendWebhookData, rules);
        log("Filter rules:" + JSON.stringify(twitterManager.filterRules));
        twitterManager.connect();

        // TODO: add express to manage easy add/remove of rules.
        app.get("/", (req, res) => {
            let statusStr = "";
            if (twitterManager.connected) {
                statusStr = "TweetBot Connected and Listening"
            } else {
                statusStr = "TweetBot Disconnected"
            }

            statusStr += "\n";
            statusStr += "Last Alive: " + twitterManager.lastAlive.toLocaleString("en-GB");
            statusStr += "\n";
            res.send(statusStr);
        });

        app.post("/channels", (req, res) => {
            // => {webhook: "https://webhook.com/etc", accounts: ["a", "b", "c"]}
            let rule = req.body;
            if (rule.webhook == undefined || !Array.isArray(rule.accounts)) {
                res.status(400);
                res.send({"success": false});
            } else {
                channelCollection.insertOne(rule);
                res.status(200);
                res.send({"success": true});
            }
        });

        app.get("/channels", async (req, res) => {
            res.send(await channelCollection.find({}).toArray());
        });

        app.get("/rules", (req, res) => {
            res.send(rules);
        });

        app.listen(process.env.PORT);
    } catch (err) {
        log(err);
        throw new Error(err);
    }
}

run().catch(err => {
    console.log(err);
});
