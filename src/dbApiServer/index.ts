import express from "express";

const port = +(process.env['PORT'] || 3000);

export function startDbApiServer() {
    let app = express();

    app.get('/', (_req, res) => res.send("Hello world"));

    app.listen(port, () => console.log(`App listening on port ${port}`));
}
