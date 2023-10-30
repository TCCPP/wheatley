import axios from "axios";
import fs from "fs/promises";

import { wheatley_auth } from "../wheatley.js";
import { delay, unwrap } from "../utils/misc.js";
import { M } from "../utils/debugging-and-logging.js";
import { MINUTE } from "../common.js";

export class Virustotal {
    key: string;
    constructor(auth: wheatley_auth) {
        this.key = unwrap(auth.virustotal);
    }

    async upload(filename: string) {
        const res = await axios.get("https://www.virustotal.com/api/v3/files/upload_url", {
            headers: {
                "x-apikey": this.key,
            },
        });
        if (res.status != 200) {
            throw Error(`Unexpected vt status ${res.status}`);
        }
        const endpoint = res.data.data;
        const form = new FormData();
        form.append("file", new Blob([await fs.readFile(filename)]));
        const upload_res = await axios.post(endpoint, form, {
            headers: {
                accept: "application/json",
                "content-type": "multipart/form-data",
                "x-apikey": this.key,
            },
        });
        if (upload_res.status != 200) {
            throw Error(`Unexpected vt status ${res.status}`);
        }
        M.log("Virustotal upload response", upload_res.data);
        while (true) {
            await delay(MINUTE);
            const res = await axios.get(upload_res.data.data.links.self, {
                headers: {
                    "x-apikey": this.key,
                },
            });
            if (res.status != 200) {
                throw Error(`Unexpected vt status ${res.status}`);
            }
            if (res.data.data.attributes.status == "completed") {
                return {
                    url: `https://www.virustotal.com/gui/file/${res.data.meta.file_info.sha256}`,
                    stats: {
                        suspicious: res.data.data.attributes.stats.suspicious,
                        malicious: res.data.data.attributes.stats.malicious,
                        undetected: res.data.data.attributes.stats.undetected,
                        failure: res.data.data.attributes.stats.failure,
                        timeout: res.data.data.attributes.stats.timeout,
                        harmless: res.data.data.attributes.stats.harmless,
                        "confirmed-timeout": res.data.data.attributes.stats["confirmed-timeout"],
                    },
                };
            }
        }
    }
}
