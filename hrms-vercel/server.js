require('dotenv').config();
const path = require('path');
const express = require('express');
const app = require('./src/app');

// Serve the frontend when running locally (Vercel serves /public automatically in production)
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`HRMS backend running locally on port ${PORT}`));
