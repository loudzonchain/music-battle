/*
  SERVER.JS - Music Battle Backend
  Phase 6: Elo + Playlists + YouTube Integration
*/

require('dotenv').config();
const express = require('express');
const Database = require('better-sqlite3');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const { v4: uuidv4 } = require('uuid');
const { calculateElo } = require('./elo');
const { google } = require('googleapis');

// ============================================
// SETUP
// ============================================

const app = express();
const PORT = process.env.PORT || 3000;

// Trust Railway's reverse proxy (needed for secure cookies over HTTPS)
app.set('trust proxy', 1);

// Middleware
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Session configuration — saveUninitialized true so anon users get a session
app.use(session({
  secret: process.env.SESSION_SECRET || 'music-battle-secret-key-change-in-production',
  resave: false,
  saveUninitialized: true,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    httpOnly: true,
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
  }
}));

// ============================================
// DATABASE SETUP
// ============================================

const db = new Database('musicbattle.db');

// Create tables
db.exec(`
  -- Songs table
  CREATE TABLE IF NOT EXISTS songs (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    artist TEXT NOT NULL,
    youtube_id TEXT NOT NULL,
    start_time INTEGER DEFAULT 0,
    votes INTEGER DEFAULT 0
  );

  -- Users table
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Votes table (tracks user)
  CREATE TABLE IF NOT EXISTS votes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT,
    winner_id INTEGER NOT NULL,
    loser_id INTEGER NOT NULL,
    voted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (winner_id) REFERENCES songs(id),
    FOREIGN KEY (loser_id) REFERENCES songs(id)
  );

  -- User preferences (legacy, kept for compat)
  CREATE TABLE IF NOT EXISTS user_preferences (
    user_id TEXT,
    artist TEXT,
    score INTEGER DEFAULT 0,
    PRIMARY KEY (user_id, artist),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  -- Personal Elo ratings (per session, per song)
  CREATE TABLE IF NOT EXISTS personal_ratings (
    session_id TEXT NOT NULL,
    song_id INTEGER NOT NULL,
    elo INTEGER DEFAULT 1500,
    battles INTEGER DEFAULT 0,
    wins INTEGER DEFAULT 0,
    PRIMARY KEY (session_id, song_id),
    FOREIGN KEY (song_id) REFERENCES songs(id)
  );

  -- Genre affinity (per session)
  CREATE TABLE IF NOT EXISTS genre_affinity (
    session_id TEXT NOT NULL,
    genre TEXT NOT NULL,
    wins INTEGER DEFAULT 0,
    total_battles INTEGER DEFAULT 0,
    PRIMARY KEY (session_id, genre)
  );

  -- User playlists (session-based)
  CREATE TABLE IF NOT EXISTS user_playlists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    username TEXT,
    song_id INTEGER NOT NULL,
    added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (song_id) REFERENCES songs(id),
    UNIQUE(session_id, song_id)
  );

  -- YouTube OAuth tokens
  CREATE TABLE IF NOT EXISTS youtube_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    username TEXT,
    access_token TEXT NOT NULL,
    refresh_token TEXT NOT NULL,
    token_expiry DATETIME NOT NULL,
    playlist_id TEXT,
    connected_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(session_id)
  );
`);

// ============================================
// MIGRATION: Add Elo columns to songs table
// ============================================

const columns = db.pragma('table_info(songs)').map(function(c) { return c.name; });
if (!columns.includes('global_elo')) {
  db.exec('ALTER TABLE songs ADD COLUMN global_elo INTEGER DEFAULT 1500');
  db.exec('ALTER TABLE songs ADD COLUMN total_battles INTEGER DEFAULT 0');
  db.exec('ALTER TABLE songs ADD COLUMN total_wins INTEGER DEFAULT 0');
  db.exec("ALTER TABLE songs ADD COLUMN genre TEXT DEFAULT 'untagged'");
  db.exec('ALTER TABLE songs ADD COLUMN prev_elo INTEGER DEFAULT 1500');

  // Migrate: set total_wins from existing votes count
  db.exec('UPDATE songs SET total_wins = votes');

  // Migrate: calculate total_battles from votes table
  var battleCounts = db.prepare(`
    SELECT song_id, COUNT(*) as battles FROM (
      SELECT winner_id as song_id FROM votes
      UNION ALL
      SELECT loser_id as song_id FROM votes
    ) GROUP BY song_id
  `).all();
  var updateBattles = db.prepare('UPDATE songs SET total_battles = ? WHERE id = ?');
  battleCounts.forEach(function(row) {
    updateBattles.run(row.battles, row.song_id);
  });

  console.log('Migrated songs table with Elo columns!');
}

// ============================================
// GENRE DATA — Assign genres to all 25 songs
// ============================================

var genreMap = {
  1: 'pop',          // Blinding Lights
  2: 'pop',          // Levitating
  3: 'pop',          // As It Was
  4: 'pop',          // Stay
  5: 'pop',          // Bad Guy
  6: 'pop',          // Shape of You
  7: 'alternative',  // Heat Waves
  8: 'pop',          // Uptown Funk
  9: 'rnb',          // Starboy
  10: 'pop',         // Don't Start Now
  11: 'hip-hop',     // God's Plan
  12: 'hip-hop',     // Hotline Bling
  13: 'hip-hop',     // Sunflower
  14: 'hip-hop',     // Old Town Road
  15: 'hip-hop',     // HUMBLE
  16: 'rock',        // Believer
  17: 'rock',        // Thunder
  18: 'alternative', // Stressed Out
  19: 'rock',        // Bohemian Rhapsody
  20: 'electronic',  // Lean On
  21: 'electronic',  // Wake Me Up
  22: 'electronic',  // Titanium
  23: 'latin',       // Despacito
  24: 'afrobeats',   // Calm Down
  25: 'rnb'          // Earned It
};

// Apply genres (runs every startup to ensure they're set)
var updateGenre = db.prepare("UPDATE songs SET genre = ? WHERE id = ? AND genre = 'untagged'");
Object.keys(genreMap).forEach(function(id) {
  updateGenre.run(genreMap[id], Number(id));
});

// Initial songs data - Verified working videos only
const initialSongs = [
  // Pop Hits (verified)
  { id: 1, title: "Blinding Lights", artist: "The Weeknd", youtube_id: "4NRXx6U8ABQ", start_time: 30 },
  { id: 2, title: "Levitating", artist: "Dua Lipa", youtube_id: "TUVcZfQe-Kw", start_time: 45 },
  { id: 3, title: "As It Was", artist: "Harry Styles", youtube_id: "H5v3kku4y6Q", start_time: 25 },
  { id: 4, title: "Stay", artist: "Kid Laroi & Justin Bieber", youtube_id: "kTJczUoc26U", start_time: 15 },
  { id: 5, title: "Bad Guy", artist: "Billie Eilish", youtube_id: "DyDfgMOUjCI", start_time: 20 },
  { id: 6, title: "Shape of You", artist: "Ed Sheeran", youtube_id: "JGwWNGJdvx8", start_time: 45 },
  { id: 7, title: "Heat Waves", artist: "Glass Animals", youtube_id: "mRD0-GxqHVo", start_time: 60 },
  { id: 8, title: "Uptown Funk", artist: "Bruno Mars", youtube_id: "OPf0YbXqDm0", start_time: 60 },
  { id: 9, title: "Starboy", artist: "The Weeknd", youtube_id: "34Na4j8AVgA", start_time: 40 },
  { id: 10, title: "Don't Start Now", artist: "Dua Lipa", youtube_id: "oygrmJFKYZY", start_time: 30 },

  // Hip-Hop (verified)
  { id: 11, title: "God's Plan", artist: "Drake", youtube_id: "xpVfcZ0ZcFM", start_time: 50 },
  { id: 12, title: "Hotline Bling", artist: "Drake", youtube_id: "uxpDa-c-4Mc", start_time: 45 },
  { id: 13, title: "Sunflower", artist: "Post Malone & Swae Lee", youtube_id: "ApXoWvfEYVU", start_time: 25 },
  { id: 14, title: "Old Town Road", artist: "Lil Nas X", youtube_id: "w2Ov5jzm3j8", start_time: 20 },
  { id: 15, title: "HUMBLE", artist: "Kendrick Lamar", youtube_id: "tvTRZJ-4EyI", start_time: 30 },

  // Rock & Alt (verified)
  { id: 16, title: "Believer", artist: "Imagine Dragons", youtube_id: "7wtfhZwyrcc", start_time: 55 },
  { id: 17, title: "Thunder", artist: "Imagine Dragons", youtube_id: "fKopy74weus", start_time: 40 },
  { id: 18, title: "Stressed Out", artist: "Twenty One Pilots", youtube_id: "pXRviuL6vMY", start_time: 60 },
  { id: 19, title: "Bohemian Rhapsody", artist: "Queen", youtube_id: "fJ9rUzIMcZQ", start_time: 50 },

  // Electronic (verified)
  { id: 20, title: "Lean On", artist: "Major Lazer & DJ Snake", youtube_id: "YqeW9_5kURI", start_time: 45 },
  { id: 21, title: "Wake Me Up", artist: "Avicii", youtube_id: "IcrbM1l_BoI", start_time: 40 },
  { id: 22, title: "Titanium", artist: "David Guetta ft. Sia", youtube_id: "JRfuAukYTKg", start_time: 60 },

  // Latin (verified)
  { id: 23, title: "Despacito", artist: "Luis Fonsi ft. Daddy Yankee", youtube_id: "kJQP7kiw5Fk", start_time: 50 },
  { id: 24, title: "Calm Down", artist: "Rema & Selena Gomez", youtube_id: "WcIcVapfqXw", start_time: 50 },

  // R&B (verified)
  { id: 25, title: "Earned It", artist: "The Weeknd", youtube_id: "waU75jdUnYw", start_time: 60 }
];

// Seed songs if database is empty
const songCount = db.prepare('SELECT COUNT(*) as count FROM songs').get();
if (songCount.count === 0) {
  const insert = db.prepare('INSERT INTO songs (id, title, artist, youtube_id, start_time, votes) VALUES (?, ?, ?, ?, ?, 0)');
  initialSongs.forEach(song => {
    insert.run(song.id, song.title, song.artist, song.youtube_id, song.start_time);
  });
  console.log('Database seeded with 25 songs!');
}

// ============================================
// AUTH ROUTES
// ============================================

// Sign up
app.post('/api/auth/signup', async (req, res) => {
  const { username, email, password } = req.body;

  if (!username || !email || !password) {
    return res.status(400).json({ error: 'All fields required' });
  }

  if (password.length < 4 || password.length > 15) {
    return res.status(400).json({ error: 'Password must be 4-15 characters' });
  }

  try {
    // Check if user exists
    const existing = db.prepare('SELECT id FROM users WHERE email = ? OR username = ?').get(email, username);
    if (existing) {
      return res.status(400).json({ error: 'Username or email already taken' });
    }

    // Hash password and create user
    const passwordHash = await bcrypt.hash(password, 10);
    const userId = uuidv4();

    db.prepare('INSERT INTO users (id, username, email, password_hash) VALUES (?, ?, ?, ?)')
      .run(userId, username, email, passwordHash);

    // Set session
    req.session.userId = userId;
    req.session.username = username;

    res.json({ success: true, user: { id: userId, username, email } });
  } catch (error) {
    console.error('Signup error:', error);
    res.status(500).json({ error: 'Failed to create account' });
  }
});

// Login
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }

  try {
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);

    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    req.session.userId = user.id;
    req.session.username = user.username;

    res.json({ success: true, user: { id: user.id, username: user.username, email: user.email } });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Logout
app.post('/api/auth/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// Get current user
app.get('/api/auth/me', (req, res) => {
  if (!req.session.userId) {
    return res.json({ user: null });
  }

  const user = db.prepare('SELECT id, username, email FROM users WHERE id = ?').get(req.session.userId);
  res.json({ user });
});

// ============================================
// SONG ROUTES
// ============================================

// Get all songs
app.get('/api/songs', (req, res) => {
  const songs = db.prepare('SELECT * FROM songs ORDER BY global_elo DESC').all();
  res.json(songs);
});

// ============================================
// SMART MATCHMAKING (Elo-aware)
// ============================================

app.get('/api/battle', (req, res) => {
  var sessionId = req.sessionID;

  // Get recent battles from session to avoid repeats
  var recentBattles = req.session.recentBattles || [];
  var recentSongIds = [];
  recentBattles.forEach(function(pair) {
    if (recentSongIds.indexOf(pair[0]) === -1) recentSongIds.push(pair[0]);
    if (recentSongIds.indexOf(pair[1]) === -1) recentSongIds.push(pair[1]);
  });

  // Get all songs
  var allSongs = db.prepare('SELECT * FROM songs').all();
  if (allSongs.length < 2) {
    return res.status(500).json({ error: 'Not enough songs' });
  }

  // 20% chance: wildcard random matchup
  if (Math.random() < 0.2) {
    var shuffled = allSongs.sort(function() { return Math.random() - 0.5; });
    return res.json({ left: shuffled[0], right: shuffled[1] });
  }

  // Filter out recently battled songs (if possible)
  var available = allSongs.filter(function(s) {
    return recentSongIds.indexOf(s.id) === -1;
  });
  // If too few available, use all songs
  if (available.length < 2) available = allSongs;

  // Pick a random seed song
  var seed = available[Math.floor(Math.random() * available.length)];

  // Get seed's Elo: personal first, then global
  var personalSeed = db.prepare('SELECT elo FROM personal_ratings WHERE session_id = ? AND song_id = ?')
    .get(sessionId, seed.id);
  var seedElo = personalSeed ? personalSeed.elo : seed.global_elo;

  // Find opponents within ±150 Elo
  var candidates = available.filter(function(s) {
    if (s.id === seed.id) return false;
    var personalOpp = db.prepare('SELECT elo FROM personal_ratings WHERE session_id = ? AND song_id = ?')
      .get(sessionId, s.id);
    var oppElo = personalOpp ? personalOpp.elo : s.global_elo;
    return Math.abs(oppElo - seedElo) <= 150;
  });

  // If no opponents in ±150, widen to ±300
  if (candidates.length === 0) {
    candidates = available.filter(function(s) {
      if (s.id === seed.id) return false;
      var personalOpp = db.prepare('SELECT elo FROM personal_ratings WHERE session_id = ? AND song_id = ?')
        .get(sessionId, s.id);
      var oppElo = personalOpp ? personalOpp.elo : s.global_elo;
      return Math.abs(oppElo - seedElo) <= 300;
    });
  }

  // Still nothing? Pick anyone except seed
  if (candidates.length === 0) {
    candidates = available.filter(function(s) { return s.id !== seed.id; });
  }

  // Pick a random opponent from candidates
  var opponent = candidates[Math.floor(Math.random() * candidates.length)];

  // Randomize left/right
  if (Math.random() > 0.5) {
    res.json({ left: seed, right: opponent });
  } else {
    res.json({ left: opponent, right: seed });
  }
});

// ============================================
// VOTE HANDLER (with Elo calculations)
// ============================================

app.post('/api/vote', (req, res) => {
  const { winnerId, loserId } = req.body;
  const userId = req.session.userId || null;
  const sessionId = req.sessionID;

  if (!winnerId || !loserId) {
    return res.status(400).json({ error: 'winnerId and loserId required' });
  }

  // Get both songs
  var winner = db.prepare('SELECT * FROM songs WHERE id = ?').get(winnerId);
  var loser = db.prepare('SELECT * FROM songs WHERE id = ?').get(loserId);

  if (!winner || !loser) {
    return res.status(400).json({ error: 'Invalid song IDs' });
  }

  // Record vote in votes table
  db.prepare('INSERT INTO votes (user_id, winner_id, loser_id) VALUES (?, ?, ?)').run(userId, winnerId, loserId);

  // Keep legacy votes count
  db.prepare('UPDATE songs SET votes = votes + 1 WHERE id = ?').run(winnerId);

  // --- GLOBAL ELO ---
  var globalResult = calculateElo(winner.global_elo, loser.global_elo);

  // Save prev_elo for delta display, then update
  db.prepare('UPDATE songs SET prev_elo = global_elo WHERE id = ?').run(winnerId);
  db.prepare('UPDATE songs SET prev_elo = global_elo WHERE id = ?').run(loserId);

  db.prepare(`
    UPDATE songs SET global_elo = ?, total_battles = total_battles + 1, total_wins = total_wins + 1
    WHERE id = ?
  `).run(globalResult.newWinnerRating, winnerId);

  db.prepare(`
    UPDATE songs SET global_elo = ?, total_battles = total_battles + 1
    WHERE id = ?
  `).run(globalResult.newLoserRating, loserId);

  // --- PERSONAL ELO (session-based) ---
  // Get or initialize personal ratings
  var personalWinner = db.prepare('SELECT * FROM personal_ratings WHERE session_id = ? AND song_id = ?')
    .get(sessionId, winnerId);
  var personalLoser = db.prepare('SELECT * FROM personal_ratings WHERE session_id = ? AND song_id = ?')
    .get(sessionId, loserId);

  // Initialize at global Elo if no personal rating exists yet
  if (!personalWinner) {
    db.prepare('INSERT INTO personal_ratings (session_id, song_id, elo, battles, wins) VALUES (?, ?, ?, 0, 0)')
      .run(sessionId, winnerId, winner.global_elo);
    personalWinner = { elo: winner.global_elo, battles: 0, wins: 0 };
  }
  if (!personalLoser) {
    db.prepare('INSERT INTO personal_ratings (session_id, song_id, elo, battles, wins) VALUES (?, ?, ?, 0, 0)')
      .run(sessionId, loserId, loser.global_elo);
    personalLoser = { elo: loser.global_elo, battles: 0, wins: 0 };
  }

  var personalResult = calculateElo(personalWinner.elo, personalLoser.elo);

  db.prepare('UPDATE personal_ratings SET elo = ?, battles = battles + 1, wins = wins + 1 WHERE session_id = ? AND song_id = ?')
    .run(personalResult.newWinnerRating, sessionId, winnerId);
  db.prepare('UPDATE personal_ratings SET elo = ?, battles = battles + 1 WHERE session_id = ? AND song_id = ?')
    .run(personalResult.newLoserRating, sessionId, loserId);

  // --- GENRE AFFINITY ---
  if (winner.genre && winner.genre !== 'untagged') {
    db.prepare(`
      INSERT INTO genre_affinity (session_id, genre, wins, total_battles)
      VALUES (?, ?, 1, 1)
      ON CONFLICT(session_id, genre) DO UPDATE SET wins = wins + 1, total_battles = total_battles + 1
    `).run(sessionId, winner.genre);
  }
  if (loser.genre && loser.genre !== 'untagged') {
    db.prepare(`
      INSERT INTO genre_affinity (session_id, genre, wins, total_battles)
      VALUES (?, ?, 0, 1)
      ON CONFLICT(session_id, genre) DO UPDATE SET total_battles = total_battles + 1
    `).run(sessionId, loser.genre);
  }

  // --- RECENT BATTLES (session) ---
  if (!req.session.recentBattles) req.session.recentBattles = [];
  req.session.recentBattles.push([winnerId, loserId]);
  if (req.session.recentBattles.length > 10) req.session.recentBattles.shift();

  // --- LEGACY: Update user preferences if logged in ---
  if (userId) {
    if (winner) {
      db.prepare(`
        INSERT INTO user_preferences (user_id, artist, score)
        VALUES (?, ?, 1)
        ON CONFLICT(user_id, artist) DO UPDATE SET score = score + 1
      `).run(userId, winner.artist);
    }
    if (loser) {
      db.prepare(`
        INSERT INTO user_preferences (user_id, artist, score)
        VALUES (?, ?, -1)
        ON CONFLICT(user_id, artist) DO UPDATE SET score = score - 1
      `).run(userId, loser.artist);
    }
  }

  // Return updated winner info
  var updatedWinner = db.prepare('SELECT * FROM songs WHERE id = ?').get(winnerId);
  res.json({
    success: true,
    message: 'Vote recorded for ' + updatedWinner.title + '!',
    newVoteCount: updatedWinner.votes,
    elo: updatedWinner.global_elo,
    eloChange: updatedWinner.global_elo - updatedWinner.prev_elo
  });
});

// ============================================
// STATS ROUTES
// ============================================

// Global stats
app.get('/api/stats', (req, res) => {
  const totalVotes = db.prepare('SELECT COUNT(*) as count FROM votes').get();
  const topSongs = db.prepare('SELECT title, artist, global_elo FROM songs ORDER BY global_elo DESC LIMIT 5').all();
  res.json({ totalBattles: totalVotes.count, topSongs });
});

// User stats (for logged in users)
app.get('/api/stats/me', (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Not logged in' });
  }

  const userId = req.session.userId;
  const userVotes = db.prepare('SELECT COUNT(*) as count FROM votes WHERE user_id = ?').get(userId);
  const topArtists = db.prepare(`
    SELECT artist, score FROM user_preferences
    WHERE user_id = ? AND score > 0
    ORDER BY score DESC LIMIT 5
  `).all(userId);

  const recentVotes = db.prepare(`
    SELECT s.title, s.artist, v.voted_at
    FROM votes v
    JOIN songs s ON v.winner_id = s.id
    WHERE v.user_id = ?
    ORDER BY v.voted_at DESC LIMIT 10
  `).all(userId);

  res.json({
    totalVotes: userVotes.count,
    topArtists,
    recentVotes
  });
});

// ============================================
// LEADERBOARD (sorted by Elo)
// ============================================

app.get('/api/leaderboard', (req, res) => {
  const songs = db.prepare(`
    SELECT
      title, artist, genre, votes, global_elo, prev_elo,
      total_battles, total_wins,
      (global_elo - prev_elo) as elo_delta,
      ROW_NUMBER() OVER (ORDER BY global_elo DESC, title ASC) as rank
    FROM songs
    ORDER BY global_elo DESC, title ASC
  `).all();
  res.json(songs);
});

// ============================================
// PLAYLIST
// ============================================

// Get current session's playlist
app.get('/api/playlist', (req, res) => {
  var sessionId = req.sessionID;
  var songs = db.prepare(`
    SELECT s.id, s.title, s.artist, s.youtube_id, s.genre, s.global_elo, p.added_at
    FROM user_playlists p
    JOIN songs s ON p.song_id = s.id
    WHERE p.session_id = ?
    ORDER BY p.added_at DESC
  `).all(sessionId);
  res.json(songs);
});

// Check if a song is already in the playlist
app.get('/api/playlist/check/:songId', (req, res) => {
  var sessionId = req.sessionID;
  var songId = Number(req.params.songId);
  var exists = db.prepare('SELECT id FROM user_playlists WHERE session_id = ? AND song_id = ?')
    .get(sessionId, songId);
  res.json({ saved: !!exists });
});

// Add song to playlist (+ YouTube sync if connected)
app.post('/api/playlist/add', async (req, res) => {
  var sessionId = req.sessionID;
  var songId = req.body.songId;

  if (!songId) {
    return res.status(400).json({ error: 'songId required' });
  }

  // Check if already saved locally
  var exists = db.prepare('SELECT id FROM user_playlists WHERE session_id = ? AND song_id = ?')
    .get(sessionId, songId);
  if (exists) {
    return res.json({ success: true, message: 'Already in playlist', youtube: false });
  }

  // Save locally first (always)
  db.prepare('INSERT INTO user_playlists (session_id, song_id) VALUES (?, ?)')
    .run(sessionId, songId);

  var song = db.prepare('SELECT * FROM songs WHERE id = ?').get(songId);
  var youtubeAdded = false;

  // Attempt YouTube sync if connected
  try {
    var ytAuth = await getYouTubeAuth(sessionId);
    if (ytAuth) {
      await addToYouTubePlaylist(ytAuth, song.youtube_id, sessionId);
      youtubeAdded = true;
    }
  } catch (e) {
    console.error('YouTube sync failed:', e.message);
  }

  var msg = youtubeAdded
    ? song.title + ' added to playlist & YouTube'
    : song.title + ' added to playlist';
  res.json({ success: true, message: msg, youtube: youtubeAdded });
});

// Remove song from playlist
app.delete('/api/playlist/remove/:songId', (req, res) => {
  var sessionId = req.sessionID;
  var songId = Number(req.params.songId);

  db.prepare('DELETE FROM user_playlists WHERE session_id = ? AND song_id = ?')
    .run(sessionId, songId);
  res.json({ success: true, message: 'Removed from playlist' });
});

// Sync all local playlist to YouTube
app.post('/api/playlist/sync-all', async (req, res) => {
  var sessionId = req.sessionID;

  try {
    var ytAuth = await getYouTubeAuth(sessionId);
    if (!ytAuth) {
      return res.status(400).json({ error: 'YouTube not connected' });
    }

    var songs = db.prepare(`
      SELECT s.youtube_id FROM user_playlists p
      JOIN songs s ON p.song_id = s.id
      WHERE p.session_id = ?
    `).all(sessionId);

    var added = 0;
    var failed = 0;
    for (var i = 0; i < songs.length; i++) {
      try {
        await addToYouTubePlaylist(ytAuth, songs[i].youtube_id, sessionId);
        added++;
      } catch (e) {
        failed++;
      }
    }

    res.json({ success: true, added: added, failed: failed, total: songs.length });
  } catch (e) {
    console.error('Sync all failed:', e.message);
    res.status(500).json({ error: 'Sync failed' });
  }
});

// ============================================
// YOUTUBE INTEGRATION
// ============================================

// OAuth2 client setup
function createOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.YOUTUBE_REDIRECT_URI
  );
}

// Get authenticated YouTube client for a session (or null)
async function getYouTubeAuth(sessionId) {
  var tokens = db.prepare('SELECT * FROM youtube_tokens WHERE session_id = ?').get(sessionId);
  if (!tokens) return null;

  var oauth2Client = createOAuth2Client();
  oauth2Client.setCredentials({
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expiry_date: new Date(tokens.token_expiry).getTime()
  });

  // Refresh if expired
  if (new Date(tokens.token_expiry) <= new Date()) {
    try {
      var refreshed = await oauth2Client.refreshAccessToken();
      var creds = refreshed.credentials;
      db.prepare('UPDATE youtube_tokens SET access_token = ?, token_expiry = ? WHERE session_id = ?')
        .run(creds.access_token, new Date(creds.expiry_date).toISOString(), sessionId);
      oauth2Client.setCredentials(creds);
    } catch (e) {
      console.error('Token refresh failed:', e.message);
      return null;
    }
  }

  return oauth2Client;
}

// Add a video to the user's YouTube playlist
async function addToYouTubePlaylist(oauth2Client, videoId, sessionId) {
  var tokens = db.prepare('SELECT playlist_id FROM youtube_tokens WHERE session_id = ?').get(sessionId);
  if (!tokens || !tokens.playlist_id) return;

  var youtube = google.youtube({ version: 'v3', auth: oauth2Client });

  // Check for duplicates first (1 quota unit)
  try {
    var existing = await youtube.playlistItems.list({
      part: 'snippet',
      playlistId: tokens.playlist_id,
      videoId: videoId,
      maxResults: 1
    });
    if (existing.data.items && existing.data.items.length > 0) {
      return; // Already in playlist
    }
  } catch (e) {
    // Continue anyway — try to add
  }

  // Add to playlist (50 quota units)
  await youtube.playlistItems.insert({
    part: 'snippet',
    requestBody: {
      snippet: {
        playlistId: tokens.playlist_id,
        resourceId: {
          kind: 'youtube#video',
          videoId: videoId
        }
      }
    }
  });
}

// Create the "Music Battle Favorites" playlist
async function createMusicBattlePlaylist(oauth2Client) {
  var youtube = google.youtube({ version: 'v3', auth: oauth2Client });

  // Check if it already exists
  try {
    var playlists = await youtube.playlists.list({
      part: 'snippet',
      mine: true,
      maxResults: 50
    });
    var existing = playlists.data.items.find(function(p) {
      return p.snippet.title === 'Music Battle Favorites';
    });
    if (existing) return existing.id;
  } catch (e) {
    console.error('Failed to check playlists:', e.message);
  }

  // Create new playlist (50 quota units)
  var result = await youtube.playlists.insert({
    part: 'snippet,status',
    requestBody: {
      snippet: {
        title: 'Music Battle Favorites',
        description: 'Songs I voted for in Music Battle'
      },
      status: {
        privacyStatus: 'unlisted'
      }
    }
  });

  return result.data.id;
}

// --- OAuth Routes ---

// Start OAuth flow
app.get('/auth/youtube', (req, res) => {
  var oauth2Client = createOAuth2Client();
  var authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: ['https://www.googleapis.com/auth/youtube']
  });
  res.redirect(authUrl);
});

// OAuth callback
app.get('/auth/youtube/callback', async (req, res) => {
  var code = req.query.code;
  if (!code) {
    return res.redirect('/playlist.html?error=no_code');
  }

  try {
    var oauth2Client = createOAuth2Client();
    var tokenResponse = await oauth2Client.getToken(code);
    var tokens = tokenResponse.tokens;

    oauth2Client.setCredentials(tokens);

    // Create or find the playlist
    var playlistId = await createMusicBattlePlaylist(oauth2Client);

    // Store tokens
    db.prepare(`
      INSERT INTO youtube_tokens (session_id, access_token, refresh_token, token_expiry, playlist_id)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(session_id) DO UPDATE SET
        access_token = ?, refresh_token = ?, token_expiry = ?, playlist_id = ?,
        connected_at = CURRENT_TIMESTAMP
    `).run(
      req.sessionID,
      tokens.access_token, tokens.refresh_token || '', new Date(tokens.expiry_date).toISOString(), playlistId,
      tokens.access_token, tokens.refresh_token || '', new Date(tokens.expiry_date).toISOString(), playlistId
    );

    res.redirect('/playlist.html?youtube=connected');
  } catch (e) {
    console.error('YouTube OAuth error:', e.message);
    res.redirect('/playlist.html?error=auth_failed');
  }
});

// Check YouTube connection status
app.get('/api/youtube/status', (req, res) => {
  var tokens = db.prepare('SELECT playlist_id, connected_at FROM youtube_tokens WHERE session_id = ?')
    .get(req.sessionID);
  res.json({
    connected: !!tokens,
    playlistId: tokens ? tokens.playlist_id : null,
    connectedAt: tokens ? tokens.connected_at : null
  });
});

// Disconnect YouTube
app.post('/auth/youtube/disconnect', (req, res) => {
  db.prepare('DELETE FROM youtube_tokens WHERE session_id = ?').run(req.sessionID);
  res.json({ success: true });
});

// ============================================
// START SERVER
// ============================================

app.listen(PORT, () => {
  console.log('');
  console.log('Music Battle Server Running!');
  console.log('http://localhost:' + PORT);
  console.log('Elo system active | Smart matchmaking | YouTube integration');
  console.log('');
});
