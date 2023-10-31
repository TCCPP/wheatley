import axios from "axios";

import { wheatley_auth } from "../wheatley.js";
import { delay, unwrap } from "../utils/misc.js";
import { M } from "../utils/debugging-and-logging.js";
import { MINUTE } from "../common.js";

export class Virustotal {
    key: string;
    constructor(auth: wheatley_auth) {
        this.key = unwrap(auth.virustotal);
    }

    async get_upload_url() {
        const res = await axios.get("https://www.virustotal.com/api/v3/files/upload_url", {
            headers: {
                "x-apikey": this.key,
            },
        });
        if (res.status != 200) {
            throw Error(`Unexpected vt status ${res.status}`);
        }
        return res.data.data;
    }

    async upload_file(file_buffer: Buffer, endpoint: string) {
        const form = new FormData();
        form.append("file", new Blob([file_buffer]));
        const upload_res = await axios.post(endpoint, form, {
            headers: {
                accept: "application/json",
                "content-type": "multipart/form-data",
                "x-apikey": this.key,
            },
        });
        if (upload_res.status != 200) {
            throw Error(`Unexpected vt status ${upload_res.status}`);
        }
        return upload_res.data;
    }

    async get_analysis(url: string) {
        const res = await axios.get(url, {
            headers: {
                "x-apikey": this.key,
            },
        });
        if (res.status != 200) {
            throw Error(`Unexpected vt status ${res.status}`);
        }
        return res.data;
    }

    async upload(file_buffer: Buffer) {
        const endpoint = await this.get_upload_url();
        const data = await this.upload_file(file_buffer, endpoint);
        M.log("Virustotal upload response", data);
        // TODO: Proper rate limit for concurrent uploads
        while (true) {
            await delay(MINUTE);
            const analysis = await this.get_analysis(data.data.links.self);
            if (analysis.data.attributes.status == "completed") {
                return {
                    url: `https://www.virustotal.com/gui/file/${analysis.meta.file_info.sha256}`,
                    stats: {
                        suspicious: analysis.data.attributes.stats.suspicious,
                        malicious: analysis.data.attributes.stats.malicious,
                        undetected: analysis.data.attributes.stats.undetected,
                        failure: analysis.data.attributes.stats.failure,
                        timeout: analysis.data.attributes.stats.timeout,
                        harmless: analysis.data.attributes.stats.harmless,
                        "confirmed-timeout": analysis.data.attributes.stats["confirmed-timeout"],
                    },
                };
            }
        }
    }
}
