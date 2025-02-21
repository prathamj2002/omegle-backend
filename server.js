const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const cors = require("cors");

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*", // Change in production for security
        methods: ["GET", "POST"]
    }
});

app.use(cors());

let waitingUsers = []; // Queue for users waiting for a match
let activePairs = {}; // Active matched users

io.on("connection", (socket) => {
    console.log(`User connected: ${socket.id}`);

    // When a user requests a match
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

    // Handle WebRTC Offer
    socket.on("offer", (data) => {
        console.log(`📤 Offer received from ${socket.id}, forwarding to ${data.target}`);
        io.to(data.target).emit("offer", { sdp: data.sdp, sender: socket.id });
    });

    // Handle WebRTC Answer
    socket.on("answer", (data) => {
        console.log(`📤 Answer received from ${socket.id}, forwarding to ${data.target}`);
        io.to(data.target).emit("answer", { sdp: data.sdp, sender: socket.id });
    });

    // Handle ICE Candidate Exchange
    socket.on("ice-candidate", (data) => {
        console.log(`📤 ICE Candidate received from ${socket.id}, forwarding to ${data.target}`);
        io.to(data.target).emit("ice-candidate", { candidate: data.candidate, sender: socket.id });
    });

    // Handle "Next" button click
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

    // Remove user from activePairs and queue on disconnect
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
    console.log(`Server running on port ${PORT}`);
});