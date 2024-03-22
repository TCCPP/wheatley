import PromClient from "prom-client";
import express from "express";
import { M } from "../utils/debugging-and-logging.js";

// Shamelessly stolen from compiler explorer

/**
 * Will launch the Prometheus metrics server
 *
 * @param serverPort - The listening port to bind into this metrics server.
 * @param hostname - The TCP host to attach the listener.
 * @returns void
 */
export function setup_metrics_server(serverPort: number, hostname: string | undefined): void {
    M.debug("Starting prometheus server");

    PromClient.collectDefaultMetrics();
    const metrics_server = express();

    metrics_server.get("/metrics", (req, res) => {
        PromClient.register
            .metrics()
            .then(metrics => {
                res.header("Content-Type", PromClient.register.contentType).send(metrics);
            })
            .catch(err => res.status(500).send(err));
    });

    // silly express typing, passing undefined is fine but
    if (hostname) {
        metrics_server.listen(serverPort, hostname);
    } else {
        metrics_server.listen(serverPort);
    }
}
