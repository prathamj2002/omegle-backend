const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const fetch = require("node-fetch"); // Ensure you install this: npm install node-fetch
const cors = require("cors");

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

app.use(cors());

// Xirsys TURN Server Credentials
const XIRSYS_API_URL = "https://global.xirsys.net/_turn/MyFirstApp";
const XIRSYS_AUTH = "Basic " + Buffer.from("prathamlakhani:07a7695a-f0a6-11ef-8d7c-0242ac150003").toString("base64");

// Create API Endpoint to Get ICE Servers
app.get("/getIceServers", async (req, res) => {
    try {
        const response = await fetch(XIRSYS_API_URL, {
            method: "PUT",
            headers: {
                "Authorization": XIRSYS_AUTH,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ format: "urls" }) // Ensure response is in the correct format
        });

        const data = await response.json();

        if (data?.v?.iceServers) {
            console.log("✅ Xirsys ICE Servers Retrieved Successfully");
            res.json(data.v.iceServers);
        } else {
            console.error("⚠️ Xirsys API returned an invalid format:", data);
            res.status(500).json({ error: "Invalid Xirsys API Response", details: data });
        }
    } catch (error) {
        console.error("🚨 Error Fetching ICE Servers:", error);
        res.status(500).json({ error: "Failed to fetch Xirsys ICE Servers" });
    }
});

// WebRTC Matching System
let waitingUsers = []; // Queue for users waiting for a match
let activePairs = {}; // Active matched users

io.on("connection", (socket) => {
    console.log(`User connected: ${socket.id}`);

    socket.on("find_match", () => {
        console.log(`User ${socket.id} requested a match`);

        if (waitingUsers.includes(socket.id)) {
            console.log(`User ${socket.id} is already in the queue`);
            return;
        }

        if (waitingUsers.length > 0) {
            let partnerSocketId = waitingUsers.shift();
            if (partnerSocketId === socket.id) {
                console.log(`Skipping self-matching for ${socket.id}`);
                return;
            }

            activePairs[socket.id] = partnerSocketId;
            activePairs[partnerSocketId] = socket.id;

            console.log(`✅ Matching ${socket.id} with ${partnerSocketId}`);

            io.to(socket.id).emit("match_found", partnerSocketId);
            io.to(partnerSocketId).emit("match_found", socket.id);
        } else {
            waitingUsers.push(socket.id);
            console.log(`User ${socket.id} added to waiting queue`);
        }
    });

    socket.on("offer", (data) => {
        console.log(`📤 Offer received from ${socket.id}, forwarding to ${data.target}`);
        io.to(data.target).emit("offer", { sdp: data.sdp, sender: socket.id });
    });

    socket.on("answer", (data) => {
        console.log(`📤 Answer received from ${socket.id}, forwarding to ${data.target}`);
        io.to(data.target).emit("answer", { sdp: data.sdp, sender: socket.id });
    });

    socket.on("ice-candidate", (data) => {
        console.log(`📤 ICE Candidate received from ${socket.id}, forwarding to ${data.target}`);
        io.to(data.target).emit("ice-candidate", { candidate: data.candidate, sender: socket.id });
    });

    socket.on("next", () => {
        let partnerId = activePairs[socket.id];
        if (partnerId) {
            console.log(`User ${socket.id} skipped ${partnerId}`);
            io.to(partnerId).emit("disconnect_peer");
            delete activePairs[partnerId];
        }
        delete activePairs[socket.id];

        waitingUsers = waitingUsers.filter(id => id !== socket.id);
        socket.emit("find_match"); // Rejoin queue for a new match
    });

    socket.on("disconnect", () => {
        let partnerId = activePairs[socket.id];
        if (partnerId) {
            console.log(`User ${socket.id} disconnected. Notifying ${partnerId}`);
            io.to(partnerId).emit("disconnect_peer");
            delete activePairs[partnerId];
        }
        delete activePairs[socket.id];
        waitingUsers = waitingUsers.filter(id => id !== socket.id);
        console.log(`User disconnected: ${socket.id}`);
    });
});

const PORT = process.env.PORT || 5001;
server.listen(PORT, () => {
    console.log(`✅ Server running on port ${PORT}`);
});
