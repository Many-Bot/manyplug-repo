# many-ai

AI agent for ManyBot using Groq API.

## How to set up

- Access: https://console.groq.com
- Log in (GitHub or Google).
- Click on "Create API key".
- Copy the key and paste it into "GROQ_API_KEY" in the settings (manybot.conf).

It is also possible for this agent to perform internet searches; for this, you need two API keys to ensure that the search is successful and accurate (optional):

- Tavily:
    - Access: https://app.tavily.com/home.
    - Log in.
    - In "API Keys", click to add a new one ("+").
    - Copy and paste into "TAVILY_API_KEY".

- Serper:
    - Access: https://serper.dev/dashboard
    - Click on "API Keys" in the upper right corner.
    - Click on "Create New Key".
    - Copy and paste into "SERPER_API_KEY".

Now you need to get your WhatsApp ID, so people can mention ManyBot and it will answer using AI. To do this, just execute in your ManyBot (^3.0.1) root:

```
$ node src/utils/get_id.js me
```

Scan the QR Code and wait, you will see something like this:

```
────────────────────────────────────────────────
Name:   Me
Number: 5566999999999
ID:     5566999999999@c.us
LID:    91234567890123@lid
────────────────────────────────────────────────
```

Copy the LID code (without the @lid) and paste on "MANYAI_LID".

manybot.conf should look like this:
```
MANYAI_LID=91234567890123

GROQ_API_KEY=gsk_...
TAVILY_API_KEY=tvly-dev-...
SERPER_API_KEY=abc1234...

PLUGINS=[
many-ai,
]
```

## How to use

On any chat, everyone that mention your contact will be automatically answered by the AI.

Like:
```
> @ManyBot search me the news?
< A portal to Equestria has been found today in Xique-Xique Bahia, in Brazil.
```

## License

MIT
