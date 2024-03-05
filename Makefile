default: help

# Some of this is shamelessly stolen from compiler explorer

help: # with thanks to Ben Rady
	@grep -E '^[0-9a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

NODE:=node
NPM:=npm
NPX:=npx
SERVER:=x0

.PHONY: prereqs
prereqs: package.json package-lock.json
	$(NPM) i

.PHONY: ts-check
ts-check: prereqs  ## ts-check
	$(NPM) run ts-check

.PHONY: lint
lint: prereqs  ## lint
	$(NPM) run lint

.PHONY: check
check: ts-check lint  ## Ts-check and lint

.PHONY: format
format: prereqs  ## Formats source files
	$(NPM) run format

.PHONY: test
test: prereqs  ## Formats source files
	$(NPM) run test

.PHONY: clean
clean:  ## Cleans up everything
	rm -rf node_modules build

.PHONY: build
build: prereqs  ## Cleans up everything
	$(NPM) run build

.PHONY: run
run: build  ## Runs the bot locally
	$(NODE) build/src/main.js

.PHONY: deploy
deploy: ts-check  ## Deploys code
	./scripts/scp.sh

.PHONY: prod
prod: deploy  ## Deploys code and restarts the bot
	ssh $(SERVER) "screen -XS _Wheatley quit; cd projects/wheatley; ./start.sh"

.PHONY: npm-update
npm-update:  ## Updates npm packages
	./scripts/update_packages.sh

.PHONY: mongo
mongo:
	ssh -L 27017:127.0.0.1:27017 x0 -N
