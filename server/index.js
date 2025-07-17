const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");
const cors = require("cors");
const bcrypt = require("bcrypt"); // For password hashing
const jwt = require("jsonwebtoken"); // For JWT
const fs = require("fs").promises; // For file system operations (to manage db.json)
const path = require("path"); // For path resolution
const cors = require('cors');
require("dotenv").config(); // Load environment variables from .env file

const app = express();
app.use(cors()); // Enable CORS for all routes
app.use(express.json()); // Enable JSON body parsing

// --- Database File Path ---
const DB_FILE = path.join(__dirname, "db.json");

// --- Helper functions for file-based database ---

/**
 * Reads data from the db.json file.
 * If the file does not exist, it creates an empty one.
 * @returns {Promise<object>} The parsed data from db.json.
 */
async function readDb() {
    try {
        const data = await fs.readFile(DB_FILE, "utf8");
        return JSON.parse(data);
    } catch (error) {
        if (error.code === 'ENOENT') { // File not found, create an empty one
            console.warn("db.json not found, creating an empty one.");
            const defaultData = { users: [], links: [] };
            await fs.writeFile(DB_FILE, JSON.stringify(defaultData, null, 2));
            return defaultData;
        }
        console.error("Error reading db.json:", error);
        throw error;
    }
}

/**
 * Writes data to the db.json file.
 * @param {object} data - The data object to write to db.json.
 * @returns {Promise<void>}
 */
async function writeDb(data) {
    try {
        await fs.writeFile(DB_FILE, JSON.stringify(data, null, 2), "utf8");
    } catch (error) {
        console.error("Error writing to db.json:", error);
        throw error;
    }
}

// JWT Secret (Store securely in .env in production)
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
    console.error("FATAL ERROR: JWT_SECRET is not defined in .env file.");
    process.exit(1); // Exit if secret is not set
}

// Middleware to verify JWT
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Extract token from "Bearer TOKEN"

    if (token == null) {
        return res.status(401).json({ error: "Authentication token required." }); // No token
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            // If token is invalid or expired, return 403 Forbidden
            return res.status(403).json({ error: "Invalid or expired token." });
        }
        req.user = user; // Attach user payload (id, email) to request object
        next(); // Proceed to the next middleware/route handler
    });
};

// --- User Authentication Endpoints ---

/**
 * Handles user registration.
 * Hashes password and stores user in db.json.
 */
app.post("/api/register", async (req, res) => {
    const { email, password } = req.body;

    // Input validation
    if (!email || !password) {
        return res.status(400).json({ error: "Email and password are required." });
    }

    try {
        const db = await readDb(); // Read current database state
        // Check if user already exists
        const existingUser = db.users.find(u => u.email === email);
        if (existingUser) {
            return res.status(409).json({ error: "User with this email already exists." });
        }

        // Hash the password (cost factor 10 is good for most applications)
        const passwordHash = await bcrypt.hash(password, 10);
        
        // Create new user object
        const newUser = { id: db.users.length + 1, email, passwordHash };
        db.users.push(newUser); // Add new user to the users array
        await writeDb(db); // Persist changes to db.json

        res.status(201).json({ message: "User registered successfully." });
    } catch (error) {
        console.error("Registration error:", error);
        res.status(500).json({ error: "Server error during registration." });
    }
});

/**
 * Handles user login.
 * Verifies credentials and issues a JWT.
 */
app.post("/api/login", async (req, res) => {
    const { email, password } = req.body;

    // Input validation
    if (!email || !password) {
        return res.status(400).json({ error: "Email and password are required." });
    }

    try {
        const db = await readDb(); // Read current database state
        // Find the user by email
        const user = db.users.find(u => u.email === email);
        if (!user) {
            return res.status(400).json({ error: "Invalid credentials." });
        }

        // Compare provided password with hashed password
        const isMatch = await bcrypt.compare(password, user.passwordHash);
        if (!isMatch) {
            return res.status(400).json({ error: "Invalid credentials." });
        }

        // Issue a JSON Web Token (JWT)
        // Payload contains user id and email, expires in 1 hour
        const accessToken = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '1h' });
        res.json({ accessToken }); // Send the token back to the client
    } catch (error) {
        console.error("Login error:", error);
        res.status(500).json({ error: "Server error during login." });
    }
});

// --- Link Saver Endpoints (Protected by authentication) ---

/**
 * Saves a new link, fetches its title/favicon, and summarizes it using Jina AI.
 * Requires authentication.
 */
app.post("/api/links", authenticateToken, async (req, res) => {
    const { url, tags = [] } = req.body; // Tags are optional, default to empty array

    // Input validation
    if (!url) {
        return res.status(400).json({ error: "URL is required." });
    }

    try {
        // --- Step 1: Fetch title and favicon from the original page ---
        let title = new URL(url).hostname; // Default title to hostname
        let favicon = new URL("/favicon.ico", url).href; // Default favicon

        try {
            // Add timeout to axios.get for external pages to prevent hanging
            const pageResponse = await axios.get(url, { timeout: 5000 }); 
            const $ = cheerio.load(pageResponse.data);

            // Try to get title from <title> tag, or OpenGraph meta tag
            title = $('title').text() || $('meta[property="og:title"]').attr('content') || title;
            
            // Try to get favicon from link tags
            let foundFavicon = $('link[rel="icon"]').attr('href') || $('link[rel="shortcut icon"]').attr('href');
            if (foundFavicon) {
                // Ensure favicon URL is absolute
                if (foundFavicon.startsWith('//')) {
                    favicon = 'http:' + foundFavicon;
                } else if (foundFavicon.startsWith('/')) {
                    favicon = new URL(foundFavicon, url).href;
                } else {
                    favicon = foundFavicon; // It's already an absolute URL
                }
            }
        } catch (scrapeError) {
            console.warn(`Failed to scrape title/favicon for ${url}:`, scrapeError.message);
            // Continue with default title/favicon if scraping fails
        }

        // --- Step 2: Call Jina AI for summarization ---
        let targetUrlForJina = url;

        // Strip the protocol (http:// or https://) if present, as Jina's endpoint already has 'http://'
        // This prevents double-protocol issues like http://https://
        if (targetUrlForJina.startsWith('https://')) {
            targetUrlForJina = targetUrlForJina.substring(8); // Remove "https://"
        } else if (targetUrlForJina.startsWith('http://')) {
            targetUrlForJina = targetUrlForJina.substring(7); // Remove "http://"
        }
        
        const encodedTargetUrlForJina = encodeURIComponent(targetUrlForJina);
        // Construct the Jina AI URL with its own 'http://' prefix
        const jinaApiUrl = `https://r.jina.ai/http://${encodedTargetUrlForJina}`;
        
        // Logging for debugging purposes (will show in server terminal)
        console.log("Original URL from frontend:", url);
        console.log("Processed URL for Jina AI (before encoding):", targetUrlForJina);
        console.log("Attempting to call Jina AI with FINAL URL:", jinaApiUrl);

        let summary = "Summary temporarily unavailable."; // Default fallback summary
        try {
            // Add timeout to axios.get for Jina AI API call
            const jinaResponse = await axios.get(jinaApiUrl, { timeout: 60000 }); 
            summary = jinaResponse.data; // Jina AI returns plain text summary
            
            // Optionally trim the summary if it's too long (e.g., to 500 characters)
            if (summary.length > 500) {
                summary = summary.substring(0, 500) + "...";
            }
        } catch (jinaErr) {
            console.warn("Jina AI summarization failed, using fallback:", jinaErr.message);
            if (jinaErr.response) {
                if (jinaErr.response.status === 429) {
                    summary = "Summary service temporarily busy (rate limit). Please try again later."; // Handle rate limiting
                } else if (jinaErr.response.status === 400) {
                    // Specific message for 400 Bad Request from Jina AI
                    summary = "Could not summarize: Invalid URL provided to summarizer. Ensure it starts with http:// or https://";
                } else {
                    summary = `Summary API error: ${jinaErr.response.status} - ${jinaErr.response.statusText || 'Unknown error'}`;
                }
            } else if (jinaErr.code === 'ECONNABORTED' || jinaErr.code === 'ETIMEDOUT') {
                summary = "Summary generation timed out.";
            } else {
                summary = "Summary temporarily unavailable due to network or unknown error.";
            }
        }

        // --- Step 3: Save the new link to db.json ---
        const db = await readDb(); // Read current database state
        const userLinks = db.links.filter(l => l.userId === req.user.id);
        
        // Create new link object
        const newLink = {
            id: Date.now(), // Use timestamp for unique ID
            userId: req.user.id, // Associate link with authenticated user
            url,
            title,
            favicon,
            summary,
            tags, // Tags for filtering (can be added via frontend input if desired)
            order: userLinks.length // Simple initial order for new links
        };
        db.links.push(newLink); // Add new link to the links array
        await writeDb(db); // Persist changes

        res.status(201).json(newLink); // Respond with the newly created link
    } catch (err) {
        console.error("Error saving link:", err.message);
        res.status(500).json({ error: "Failed to save link and generate summary." });
    }
});

/**
 * Fetches all links for the authenticated user.
 * Requires authentication.
 */
app.get("/api/links", authenticateToken, async (req, res) => {
    try {
        const db = await readDb(); // Read current database state
        // Filter links by the authenticated user's ID
        const userLinks = db.links.filter(l => l.userId === req.user.id);
        // Sort links by their 'order' property for consistent display
        res.json(userLinks.sort((a, b) => a.order - b.order));
    } catch (error) {
        console.error("Error fetching links:", error);
        res.status(500).json({ error: "Failed to retrieve links." });
    }
});

/**
 * Deletes a link by its ID for the authenticated user.
 * Requires authentication.
 */
app.delete("/api/links/:id", authenticateToken, async (req, res) => {
    const linkId = parseInt(req.params.id); // Parse ID from URL parameter

    try {
        const db = await readDb(); // Read current database state
        // Find the index of the link to delete, ensuring it belongs to the authenticated user
        const linkIndex = db.links.findIndex(l => l.id === linkId && l.userId === req.user.id);

        if (linkIndex === -1) {
            return res.status(404).json({ error: "Link not found or not authorized." });
        }

        db.links.splice(linkIndex, 1); // Remove the link from the array
        await writeDb(db); // Persist changes

        res.status(204).send(); // No content response for successful deletion
    } catch (error) {
        console.error("Error deleting link:", error);
        res.status(500).json({ error: "Failed to delete link." });
    }
});

/**
 * Updates the order of links for the authenticated user based on a provided array of IDs.
 * Requires authentication.
 */
app.put("/api/links/reorder", authenticateToken, async (req, res) => {
    const { orderedLinkIds } = req.body; // Expect an array of link IDs in the new order

    if (!Array.isArray(orderedLinkIds)) {
        return res.status(400).json({ error: "orderedLinkIds must be an array." });
    }

    try {
        const db = await readDb(); // Read current database state
        const userLinks = db.links.filter(l => l.userId === req.user.id);

        // Basic validation: ensure all IDs in orderedLinkIds belong to the user and are present
        const allIdsBelongToUser = orderedLinkIds.every(id => userLinks.some(l => l.id === id));
        if (userLinks.length !== orderedLinkIds.length || !allIdsBelongToUser) {
            return res.status(400).json({ error: "Invalid list of link IDs for reordering." });
        }

        // Update the 'order' property for each link based on the new sequence
        orderedLinkIds.forEach((id, index) => {
            const link = db.links.find(l => l.id === id && l.userId === req.user.id);
            if (link) {
                link.order = index; // Assign new order
            }
        });

        await writeDb(db); // Persist changes
        res.status(200).json({ message: "Links reordered successfully." });
    } catch (error) {
        console.error("Error reordering links:", error);
        res.status(500).json({ error: "Failed to reorder links." });
    }
});

// --- Server Start ---
const PORT = process.env.PORT || 5000;
app.listen(PORT, () =>
    console.log(`✅ Backend running on http://localhost:${PORT}`)
);
