#!/bin/bash

#scp -r package.json package-lock.json tsconfig.json src d0:Projects/Wheatley
rsync -av --checksum package.json package-lock.json start.sh run-persist.sh tsconfig.json indexes src test wiki config.jsonc scripts x0:projects/wheatley --exclude={"indexes/cppref/*.txt","indexes/cppref/*cppreference*","*.js","src/wheatley-private/.git","wiki/node_modules"}
#rsync -av -I package.json package-lock.json tsconfig.json cppref src test d0:Projects/Wheatley --exclude={"cppref/*.txt","cppref/*cppreference*"}

# scp d0:Projects/wheatley/log.txt .
