const Flint = require("node-flint")
const webhook = require("node-flint/webhook")
const f = require("node-fetch")
const express = require("express")
const bodyParser = require("body-parser")
const app = express()

const url = process.env.TokenResolverURL

const config = {
    webhookUrl:  process.env.WebhookRecipientURL,
    token: process.env.BotToken,
    port: process.env.Port
}

app.use(bodyParser.json())
// create and start a flint instance
var flint = new Flint(config)
flint.start()

// the findScopeForNamedToken makes a request to an internal URL to retrieve all tokens associated with the account
// then it filters down to the integration name, i.e. client_name and since even now we may have more than one token
// it uses the newest one to query the scopes
function findScopeForNamedToken(res, tokenName) {
    if ( ! res ) {
        return "token not resolveable"
    }
    const namedToken = res.filter( (e) => {
        // finds all the access tokens with the name provided
        return ( e.token_type==="access_token" && e.client_name===tokenName)
    })
    if ( ! namedToken || namedToken.length === 0 ) {
        return "could not find a token by that name"
    }
    // let's sort the tokens by newest first
    const sortedArray = [...namedToken].sort( (e1,e2) => {
        return e2.expires_in - e1.expires_in
    })
    return (sortedArray[0].oauth2scope.filter( (e) => { return ( e !== 'spark:kms')}))
}


function dissallowGroupChats(bot, trigger) {

    if (trigger.roomType !== 'direct') {
        bot.say("I can only be used in direct messages to avoid leaking tokens")
        bot.say("I am going to bid my farwell here and hope to see you soon in a one on one space")
        bot.dm(trigger.personEmail, "text", "Hello " + trigger.personDisplayName + " you can talk to me here"). then ( () => { bot.exit() })
        return (disallowed=true)
    }
}


// tests if the bot was added to a group space, which is not what we want to allow
// the reason is because we don't want others to see any token
flint.on('spawn',(bot, id) => {
    // if this is a group room we want to remove the bot
    if ( bot.isGroup || ! bot.isDirect ) {
        bot.say("Yo, someone did add me to a group room, but I can only talk in private rooms")
        console.log("bot addedBy is " + bot.addedBy)
        if ( bot.addedBy ) {
            bot.dm(bot.addedBy, "text", "Hello " + bot.addedBy + " you can talk to me here")
            }
        bot.exit()
        flint.despawn(bot.room.id);
    }
})


// flint receives the command to resolve a token
flint.hears('/resolve', (bot, trigger) => {

    if ( dissallowGroupChats(bot,trigger)) {
        return
    }

    const w = trigger.text.split(' ')
    const token = w[w.length-2]
    const name = w[w.length-1]

    bot.say("will resolve token ... " + token.slice(-6)  + " with the name " + name)

    try {
        const header = new f.Headers( { 'Content-type' : 'application/json',
            'Authorization' : `Bearer ${token}` } )
        var results = f.default(url, {headers: header}).then((res) => {
            return res.json()
        }).then((res) => {
            return findScopeForNamedToken(res.data, name)
        }).then((scopes) => {
            bot.say( "the scopes are... " + scopes)
        })
    } catch ( ex ) {
        bot.say("Some issues arose....duh....")
    }
}, "resolve a token to a scope", 0)

// that's what we want to ultimately execute
// curl -X GET -H "Authorization: Bearer xxxxxx” -H "Content-Type: application/json"
// https://idbroker.webex.com/idb/oauth2/v1/tokens/me
flint.hears('/hello', (bot, trigger) => {
    if ( dissallowGroupChats(bot,trigger)) {
        return
    }
    bot.say("Hello %s!", trigger.personDisplayName )
},"Says hello to the user",0)



flint.hears('/help', (bot, trigger) => {
    console.log("help requested")
    bot.say("This bot will resolve a oAuth Integration tokens into scopes. You should call me like so: /resolve TOKEN" +
        " TOKENNAME")
    bot.say("Yes, that\'s a leading forward slash /")
    bot.say("The TokenName can be found in your account as Name (Name of your Integration)")
    bot.say("I will return only information about the last token with this name")
},"provides help menu", 0)


flint.hears(/\/?.*/, (bot,trigger) => {
   bot.say("unknown command received")
    bot.say("This bot will resolve a oAuth Integration tokens into scopes. You should call me like so: /resolve TOKEN" +
        " TOKENNAME")
    bot.say("Yes, that\'s a leading forward slash /")
    bot.say("The TokenName can be found in your account as Name (Name of your Integration)")
    bot.say("I will return only information about the last token with this name")
},"unknown command received",3)


app.post('/flint', webhook(flint))

app.get('/flint', (req,res) => {
    console.log("got a GET request")
    res.status = 200
    res.send("hello you")
})

var server = app.listen(config.port,  () => {
    console.log("app is now listening on port " + config.port)
    flint.debug('Flint listening on port %s', config.port);
});

// gracefully shutdown (ctrl-c)
process.on('SIGINT', function() {
    flint.debug('stoppping...');
    server.close();
    flint.stop().then(function() {
        process.exit();
    });
});

