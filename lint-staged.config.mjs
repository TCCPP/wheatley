export default {
    "*.ts": [() => "npm run ts-check", "npm run format-files --", "npm run lint-files --"],
    "*.js": ["npm run format-files --", "npm run lint-files --"],
    "*.{html,md}": ["npm run format-files --"],
};
