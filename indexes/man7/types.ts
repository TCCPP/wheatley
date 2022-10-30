export type man7_entry = {
    title: string;
    path: string;
    name?: string;
    synopsis?: string;
}

export type WorkerJob = {
    path: string;
    url: string;
};

export type WorkerResponse = man7_entry | null;
