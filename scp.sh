#!/bin/bash

#scp -r package.json package-lock.json tsconfig.json src d0:Projects/Wheatley
rsync -av --checksum package.json package-lock.json tsconfig.json src d0:Projects/Wheatley
