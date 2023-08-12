# Wheatley

[![build](https://github.com/jeremy-rifkin/wheatley/actions/workflows/build.yml/badge.svg)](https://github.com/jeremy-rifkin/wheatley/actions/workflows/build.yml)
[![test](https://github.com/jeremy-rifkin/wheatley/actions/workflows/test.yml/badge.svg)](https://github.com/jeremy-rifkin/wheatley/actions/workflows/test.yml)
[![eslint](https://github.com/jeremy-rifkin/wheatley/actions/workflows/eslint.yml/badge.svg)](https://github.com/jeremy-rifkin/wheatley/actions/workflows/eslint.yml)

This repository contains the source code for the Wheatley bot, made for the Together C & C++ discord server.

## Project Structure

- `indexes/` Code for processing cppreference and man7 data to create a searchable index
- `src/` Main source code for the bot
  - `algorithm/` Algorithmic utilities for the bot, such as levenshtein distance
  - `components/` Bot components
  - `infra/` Bot infrastructure, such as database interaction
  - `test/` Test cases
  - `wheatley-private/` Private components, these are primarily internal moderation and administration tools such as
    raid detection and handling.

The bot is very modular and most components are completely independent of other components.

## Local Development

The bot relies on a lot of server-specific information, such as IDs for channels and roles. Components which do not rely
on any server-specific information are marked as freestanding. When developing locally, configure the bot as
freestanding (see below). If you are working on a component which relies on server specific information, the best
solution currently is the following:

1. Look at what server-specific pieces the component needs (channels, roles, etc.) and create copies in your development
   server. Server-specific pieces needed by the component can be found easily by searching for `this.wheatley.channels.`
   and `this.wheatley.roles.`.
2. Update constants in `src/wheatley.ts` as needed - all constants are at the top of the file.
3. Set the component to be enabled in freestanding mode with:

```ts
    static override get is_freestanding() {
        return true;
    }
```

## auth.json

Secrets and other bot info must be configured in the bot.json file. An example looks like:

```json
{
  "id": "<bot id>",
  "guild": "<guild id>",
  "token": "<discord api token>",
  "mongo": {
    "user": "wheatley",
    "password": "<mongo password>"
  },
  "freestanding": false
}
```

Mongo credentials can be omitted locally if you don't need to work on components that use mongo. `freestanding: true`
can be specified to turn on only components which don't rely on channels etc. specific to Together C & C++ to exist.
Freestanding mode also disables connecting to MongoDB.

## Database

The bot uses MongoDB. It previously used a giant json file (the migration script is located in the scripts folder). For
local development you likely won't need to setup a mongo database, depending on the components you're working on.
However, if you are contributing to components that do need the database here are the installation steps for ubuntu:

https://www.mongodb.com/docs/manual/tutorial/install-mongodb-on-ubuntu/

```sh
sudo apt-get install gnupg curl
curl -fsSL https://pgp.mongodb.com/server-6.0.asc | \
   sudo gpg -o /usr/share/keyrings/mongodb-server-6.0.gpg \
   --dearmor
echo "deb [ arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-6.0.gpg ] https://repo.mongodb.org/apt/ubuntu focal/mongodb-org/6.0 multiverse" | sudo tee /etc/apt/sources.list.d/mongodb-org-6.0.list
sudo apt-get update
sudo apt-get install -y mongodb-org
sudo systemctl start mongod
sudo systemctl status mongod
sudo systemctl enable mongod
sudo ufw deny 27017
mongosh
# use admin
# db.createUser({user:'mongoadmin', pwd: '<password>', roles:['userAdminAnyDatabase']})
# db.auth('mongoadmin', '<password>') # test that authentication works
# db.createUser({user:'wheatley', pwd: '<password>', roles:[{db:'wheatley', role:'readWrite'}]})
# use wheatley
sudo vim /etc/mongod.conf
# net:
#   port: 27017
#   bindIp: 127.0.0.1
# security:
#   authorization: enabled
sudo systemctl restart mongod
```

To connect with [compass](https://www.mongodb.com/try/download/compass) to a mongo server setup on another server:
`ssh -L 27017:127.0.0.1:27017 <server> -N`.
