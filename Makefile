default: help

# The general philosophy and functionality of this makefile is shamelessly stolen from compiler explorer

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
prod: format deploy  ## Deploys code and restarts the bot
	ssh $(SERVER) "export NVM_DIR=\"$$HOME/.nvm\"; source $$NVM_DIR/nvm.sh; screen -XS _Wheatley quit; cd projects/wheatley; ./start.sh"

.PHONY: update
update:  ## Updates npm packages
	./scripts/update_packages.sh

.PHONY: mongo
mongo:  ## Port forward mongo
	ssh -L 27017:127.0.0.1:27017 x0 -N

.PHONY: build-dev-container
build-dev-container:  ## Build dev container container
	podman build -t wheatley-dev -f dev-container/Dockerfile .

.PHONY: run-dev-container
run-dev-container: build-dev-container  ## Runs the dev container container
	podman run --user=wheatley --cap-drop=all -it wheatley-dev

.PHONY: dev
dev: build  ## Runs in dev mode
	node build/src/main.js
