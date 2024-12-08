FROM ubuntu:22.04

ENV DEBIAN_FRONTEND noninteractive

# Basic software setup
RUN apt update
RUN apt install -y curl wget vim git make build-essential net-tools gnupg expect

# node
RUN curl -fsSL https://deb.nodesource.com/setup_21.x | bash -
RUN apt install -y nodejs

# Mongodb
RUN curl -fsSL https://www.mongodb.org/static/pgp/server-8.0.asc | \
    gpg -o /usr/share/keyrings/mongodb-server-8.0.gpg \
    --dearmor
RUN echo "deb [ arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-8.0.gpg ] https://repo.mongodb.org/apt/ubuntu jammy/mongodb-org/8.0 multiverse" | \
    tee /etc/apt/sources.list.d/mongodb-org-8.0.list
RUN apt update
RUN apt install -y mongodb-org

# Cleanup apt stuff
RUN apt-get clean
RUN rm -rf /var/lib/apt/lists/*

# Setup a user
RUN groupadd wheatley
RUN useradd -m -g wheatley -s /bin/bash wheatley
RUN mkdir /opt/wheatley/ && chown wheatley:wheatley /opt/wheatley/
RUN mkdir /opt/mongo/ && mkdir /opt/mongo/data && chown -R wheatley:wheatley /opt/mongo/
USER wheatley

COPY dev-container/entry.sh /entry.sh

WORKDIR /opt/wheatley
COPY --chown=wheatley:wheatley . .

ENTRYPOINT ["/entry.sh"]
