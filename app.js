const express = require('express');
const app = express();
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');


const db = new sqlite3.Database('polls.db');

// Run the schema to create the necessary tables
db.exec(fs.readFileSync('schema.sql', 'utf8'));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));


// Create a new poll and redirect to the poll page
app.post('/create-poll', async (req, res) => {
  try {
    const question = req.body.question;
    const options = req.body.options.split(',').map(option => option.trim());

    if (!question || options.length < 2) {
      res.status(400).send('Invalid question or options');
      return;
    }

    const pollId = uuidv4(); // Generate a unique, cryptographically secure poll ID

    // Insert the poll question into the "polls" table
    await new Promise((resolve, reject) => {
      db.run('INSERT INTO polls (id, question) VALUES (?, ?)', [pollId, question], (err) => {
        if (err) reject(err);
        resolve();
      });
    });

    // Insert poll options into the "poll_options" table
    for (const option of options) {
      await new Promise((resolve, reject) => {
        db.run('INSERT INTO poll_options (poll_id, option_text) VALUES (?, ?)', [pollId, option], (err) => {
          if (err) reject(err);
          resolve();
        });
      });
    }

    // Redirect the user to the newly created poll
    res.redirect(`/poll.html?poll=${pollId}`);
  } catch (err) {
    console.error(err);
    res.status(500).send('Error creating poll');
  }
});

app.get('/poll/:pollId', async (req, res) => {
  const pollId = req.params.pollId;

  try {
    // Check if the poll exists in the database
    const poll = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM polls WHERE id = ?', [pollId], (err, row) => {
        if (err) reject(err);
        resolve(row);
      });
    });

    if (!poll) {
      res.status(404).send('Poll not found');
      return;
    }

    // Fetch poll options from the database
    const options = await new Promise((resolve, reject) => {
      db.all('SELECT * FROM poll_options WHERE poll_id = ?', [pollId], (err, rows) => {
        if (err) reject(err);
        resolve(rows);
      });
    });

    const votes = await new Promise((resolve, reject) => {
      db.all('SELECT poll_option_id, voter_name FROM votes JOIN poll_options po ON votes.poll_option_id = po.id WHERE po.poll_id = ?', [pollId], (err, rows) => {
        if (err) reject(err);
        resolve(rows);
      });
    });

    options.map(option => {
      option.votes = votes.filter(vote => vote.poll_option_id === option.id);
    });

    const totalVotes = votes.length;

    // Return the poll.html file and poll data
    // res.sendFile(path.join(__dirname, 'public', 'poll.html'));
    res.send({ poll, options, totalVotes });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error fetching poll');
  }
});

// Record a vote for a poll option
app.post('/vote/:pollId', async (req, res) => {
  const pollId = req.params.pollId;
  const optionId = req.body.option;
  const ipAddress = req.ip;
  const voterName = req.body.name;

  if (!voterName) {
    res.status(400).send('Invalid name');
    return;
  }

  try {
    // Check if the poll exists in the database
    const poll = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM polls WHERE id = ?', [pollId], (err, row) => {
        if (err) reject(err);
        resolve(row);
      });
    });

    if (!poll) {
      res.status(404).send('Poll not found');
      return;
    }

    // Check if the user has already voted
    const existingVote = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM votes JOIN poll_options po ON votes.poll_option_id = po.id WHERE po.poll_id = ? AND voter_ip = ?', [pollId, ipAddress], (err, row) => {
        if (err) reject(err);
        resolve(row);
      });
    });

    if (existingVote) {
      res.status(403).send('You have already voted');
      return;
    }

    // Record the vote in the "votes" table
    await new Promise((resolve, reject) => {
      db.run('INSERT INTO votes (poll_option_id, voter_ip, voter_name) VALUES (?, ?, ?)', [optionId, ipAddress, voterName], (err) => {
        if (err) reject(err);
        resolve();
      });
    });

    res.status(200).send('Vote recorded');
  } catch (err) {
    console.error(err);
    res.status(500).send('Error recording vote');
  }
});

module.exports = app;
