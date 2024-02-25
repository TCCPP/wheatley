default: help

# Some of this is shamelessly stolen from compiler explorer

help: # with thanks to Ben Rady
	@grep -E '^[0-9a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

NODE:=node
NPM:=npm
NPX:=npx
SERVER:=x0

.PHONY: prereqs
prereqs: package-lock.json
	$(NPM) i

.PHONY: lint
lint: prereqs  ## Ts-check and lint
	$(NPM) run ts-check
	$(NPM) run lint

.PHONY: check
check: prereqs  ## Run ts-check
	$(NPM) run ts-check

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

.PHONY: dev
dev: build  ## Runs the bot locally
	$(NODE) build/src/main.js

.PHONY: prod
prod:  ## Runs the site as a developer; including live reload support and installation of git hooks
	./scripts/scp.sh
	ssh $(SERVER) "screen -XS _Wheatley quit; cd projects/wheatley; ./start.sh"
