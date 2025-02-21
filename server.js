import express from "express";
import http from "http";
import { Server } from "socket.io"; // ✅ Fixed import
import fetch from "node-fetch";
import cors from "cors";

const app = express();
const server = http.createServer(app);
const io = new Server(server, { // ✅ Fixed instantiation
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
        console.log("📡 Requesting ICE servers from Xirsys...");
        
        const response = await fetch(XIRSYS_API_URL, {
            method: "PUT",
            headers: {
                "Authorization": XIRSYS_AUTH,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ format: "urls" })
        });

        const data = await response.json();

        if (!response.ok) {
            console.error("🚨 Xirsys API Error:", data);
            return res.status(500).json({ error: "Xirsys API Error", details: data });
        }

        if (data?.v?.iceServers && typeof data.v.iceServers === "object") {
            // Convert Xirsys response into an array of ICE servers
            const formattedIceServers = [
                {
                    urls: data.v.iceServers.urls,
                    username: data.v.iceServers.username || "",
                    credential: data.v.iceServers.credential || ""
                }
            ];
        
            console.log("✅ Fixed Xirsys ICE Servers Format:", formattedIceServers);
            return res.json(formattedIceServers);
        } else {
            console.error("⚠️ Invalid Xirsys API Response:", data);
            return res.status(500).json({ error: "Invalid Xirsys API Response", details: data });
        }
        
    } catch (error) {
        console.error("🚨 Error Fetching ICE Servers:", error);
        return res.status(500).json({ error: "Failed to fetch Xirsys ICE Servers" });
    }
});


// WebRTC Matching System
let waitingUsers = []; // Queue for users waiting for a match
let activePairs = {}; // Active matched users

io.on("connection", (socket) => {


    console.log(`User connected: ${socket.id}`);

    console.log("🚀 Active WebSocket Connections:", io.engine.clientsCount);
    console.log("🚀 Active User IDs:", Object.keys(activePairs));
    console.log("🚀 Waiting Queue:", waitingUsers);
    console.log("🚀 All connected sockets:", Object.keys(io.sockets.sockets));


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
        socket.emit("find_match");
    });

    socket.on("disconnect", () => {
        console.log(`❌ User disconnected: ${socket.id}`);
    
        if (activePairs[socket.id]) {
            let partnerId = activePairs[socket.id];
            console.log(`🔴 Notifying partner ${partnerId} that ${socket.id} disconnected`);
            io.to(partnerId).emit("disconnect_peer");
            delete activePairs[partnerId];
        }
    
        // ✅ Remove user from active lists
        delete activePairs[socket.id];
        waitingUsers = waitingUsers.filter(id => id !== socket.id);
    
        console.log(`🚀 Updated active users:`, Object.keys(activePairs));
        console.log(`🚀 Updated waiting queue:`, waitingUsers);
    });
    
    
});

const PORT = process.env.PORT || 5001;
server.listen(PORT, () => {
    console.log(`✅ Server running on port ${PORT}`);
});
