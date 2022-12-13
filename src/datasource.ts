import {IntegrationBase} from "@budibase/types"
import fetch from "node-fetch"
import redis from 'redis';
import { promisify } from 'node:util';

interface Query {
    method: string
    body?: string
    headers?: { [key: string]: string }
}

class CustomIntegration implements IntegrationBase {
    private readonly url: string = 'https://api.controlbyweb.cloud/api/v1';
    private readonly username: string;
    private readonly password: string;

    private redis: any;

    constructor(config: { username: string; password: string; }) {
        this.username = encodeURIComponent(config.username);
        this.password = encodeURIComponent(config.password);
        this.redis = redis.createClient({url: 'redis://redis:6379'});
    }

    async getCBWAccessToken() {
        const response = await fetch(`${this.url}/auth/token`, {
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8'
            },
            body: `username=${this.username}&password=${this.password}&grant_type=password`
        })

        const json = await response.json();

        return {
            ttl: json.expires_in,
            token: json.access_token
        }
    }

    async request(url: string, opts: Query) {
        const getKey = promisify(this.redis.get).bind(this.redis);
        const setKey = promisify(this.redis.set).bind(this.redis);

        let accessToken = await getKey('accessToken');

        if (!accessToken) {
            const { ttl, token } = await this.getCBWAccessToken();
            await setKey('accessToken', token, 'EX', ttl);
            accessToken = token;
        }

        const authorization = { Authorization: `Bearer ${accessToken}` };

        if (!opts.headers) {
            opts.headers = authorization;
        } else {
            opts.headers = { ...opts.headers, ...authorization };
        }

        opts.headers['Accept'] = 'application/json';

        const response = await fetch(url, opts);

        if (response.status <= 300) {
            try {
                const contentType = response.headers.get("content-type")
                if (contentType?.includes("json")) {
                    return await response.json()
                } else {
                    return await response.text()
                }
            } catch (err) {
                return await response.text()
            }
        } else {
            const err = await response.text()
            throw new Error(err)
        }
    }

    async create(query: { path: string; json: object }) {
        const opts = {
            method: "POST",
            body: JSON.stringify(query.json),
            headers: {
                "Content-Type": "application/json",
            },
        }
        return this.request(`${this.url}${query.path}`, opts)
    }

    async read(query: { path: string; }) {
        const opts = {
            method: "GET",
        }
        return this.request(`${this.url}${query.path}`, opts)
    }

    async update(query: { path: string; json: object; }) {
        const opts = {
            method: "PUT",
            body: JSON.stringify(query.json),
            headers: {
                "Content-Type": "application/json",
            },
        }
        return this.request(`${this.url}${query.path}`, opts)
    }

    async delete(query: { path: string; }) {
        const opts = {
            method: "DELETE",
        }
        return this.request(`${this.url}${query.path}`, opts)
    }
}

export default CustomIntegration
