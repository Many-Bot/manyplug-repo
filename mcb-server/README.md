# mcb-server

Minecraft Bedrock server monitor for ManyBot. Shows when players join/leave your server.

## Installation

```bash
manyplug install mcb-server
```

## Configuration

Add to your `manybot.conf`:

```
MC_GROUP_ID=5566999999999@g.us    # WhatsApp group to send notifications
MC_LOG_FILE=/path/to/server.log   # Path to your Minecraft server log
```

## Features

- **Auto notifications**: Sends messages when players connect/disconnect
- **Username registration**: Map WhatsApp users to Minecraft usernames
- **Player list**: See who's online with WhatsApp mappings

## Commands

| Command | Description |
|---------|-------------|
| `!players` | List players currently online |
| `!mcreg <username>` | Register your Minecraft username |
| `!mcunreg` | Unregister your username |
| `!mclist` | List all registered users |

## Example

```
!mcreg Steve
✅ Steve registered as You!

!players
*Players playing Minecraft currently: 2*
- Steve (WhatsApp: @5566999999999)
- Alex
```

## License

MIT
