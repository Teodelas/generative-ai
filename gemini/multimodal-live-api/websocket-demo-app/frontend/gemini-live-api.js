class GeminiLiveResponseMessage {
    constructor(data) {
        this.data = "";
        this.type = "";
        this.endOfTurn = data?.serverContent?.turnComplete;
        this.usageMetadata = null;

        const parts = data?.serverContent?.modelTurn?.parts;

        if (data?.setupComplete) {
            this.type = "SETUP COMPLETE";
        } else if (data?.usageMetadata) {
            // NEW: this block checks for and captures the usage metadata. It sets the type so it can be 
            // easily checked for later
            this.type = "USAGE_METADATA";
            this.usageMetadata = data.usageMetadata;
        }else if (parts?.length && parts[0].text) {
            this.data = parts[0].text;
            this.type = "TEXT";
        } else if (parts?.length && parts[0].inlineData) {
            this.data = parts[0].inlineData.data;
            this.type = "AUDIO";
        }
    }
}

class GeminiLiveAPI {
    constructor(proxyUrl, projectId, model, apiHost) {
        this.proxyUrl = proxyUrl;

        this.projectId = projectId;
        this.model = model;
        this.modelUri = `projects/${this.projectId}/locations/us-central1/publishers/google/models/${this.model}`;

        this.responseModalities = ["AUDIO"];
        this.systemInstructions = "";

        this.apiHost = apiHost;
        this.serviceUrl = `wss://${this.apiHost}/ws/google.cloud.aiplatform.v1beta1.LlmBidiService/BidiGenerateContent`;
        
        // NEW: hold the running total for the session
        this.sessionTotalTokens = 0;
        this.sessionPromptTokens = 0;
        this.sessionResponseTokens = 0;

        this.onReceiveResponse = (message) => {
            console.log("Default message received callback", message);
        };

        this.onConnectionStarted = () => {
            console.log("Default onConnectionStarted");
        };

        this.onErrorMessage = (message) => {
            alert(message);
        };

        this.accessToken = "";
        this.websocket = null;

        console.log("Created Gemini Live API object: ", this);
    }

    //NEW: expose a way to get session tokens
    getSessionTokenTotal() {
        return this.sessionTotalTokens;
    }

    getSessionPromptTokenTotal() {
        return this.sessionPromptTokens;
    }

    getSessionResponseTokenTotal() {
        return this.sessionResponseTokens;
    }

    setProjectId(projectId) {
        this.projectId = projectId;
        this.modelUri = `projects/${this.projectId}/locations/us-central1/publishers/google/models/${this.model}`;
    }

    setAccessToken(newAccessToken) {
        console.log("setting access token: ", newAccessToken);
        this.accessToken = newAccessToken;
    }

    connect(accessToken) {
        this.setAccessToken(accessToken);
        this.setupWebSocketToService();
    }

    disconnect() {
        this.webSocket.close();
    }

    sendMessage(message) {
        this.webSocket.send(JSON.stringify(message));
    }

    onReceiveMessage(messageEvent) {
        console.log("Message received: ", messageEvent);
        const messageData = JSON.parse(messageEvent.data);
        // NEW: Check for usageMetadata and add to the running total.
        if (messageData.usageMetadata) {
            const tokensInTurn = messageData.usageMetadata.totalTokenCount || 0;
            const promptTokensInTurn = messageData.usageMetadata.promptTokenCount || 0;
            const responseTokensInTurn = messageData.usageMetadata.candidatesTokenCount || 0;

            this.sessionPromptTokens += promptTokensInTurn;
            this.sessionResponseTokens += responseTokensInTurn;
            this.sessionTotalTokens += tokensInTurn;
            console.log(`Session total tokens: ${this.sessionTotalTokens}`);
        }
        const message = new GeminiLiveResponseMessage(messageData);
        console.log("onReceiveMessageCallBack this ", this);
        this.onReceiveResponse(message);
    }

    setupWebSocketToService() {
        console.log("connecting: ", this.proxyUrl);
        // NEW: Reset the session token count each time a new connection is made.
        this.sessionTotalTokens = 0;
        this.sessionPromptTokens = 0;
        this.sessionResponseTokens = 0;

        this.webSocket = new WebSocket(this.proxyUrl);

        this.webSocket.onclose = (event) => {
            console.log("websocket closed: ", event);
            this.onErrorMessage("Connection closed");
        };

        this.webSocket.onerror = (event) => {
            console.log("websocket error: ", event);
            this.onErrorMessage("Connection error");
        };

        this.webSocket.onopen = (event) => {
            console.log("websocket open: ", event);
            this.sendInitialSetupMessages();
            this.onConnectionStarted();
        };

        this.webSocket.onmessage = this.onReceiveMessage.bind(this);
    }

    sendInitialSetupMessages() {
        const serviceSetupMessage = {
            //commented out because we're using service account to authenticate
            //bearer_token: this.accessToken,
            service_url: this.serviceUrl,
        };
        //commented out because the first message configures authentication assuming a token
        //look in backend/main.py under handle_client()
        //this.sendMessage(serviceSetupMessage);

        const sessionSetupMessage = {
            setup: {
                model: this.modelUri,
                generation_config: {
                    response_modalities: this.responseModalities,
                    speech_config: {
                        voice_config: {
                            prebuilt_voice_config: {voice_name: "puck"},
                        },
                        language_code: "en-US"
                    }
                },
                system_instruction: {
                    parts: [{ text: this.systemInstructions }],
                },
            },
        };
        this.sendMessage(sessionSetupMessage);
    }

    sendTextMessage(text) {
        const textMessage = {
            client_content: {
                turns: [
                    {
                        role: "user",
                        parts: [{ text: text }],
                    },
                ],
                turn_complete: true,
            },
        };
        this.sendMessage(textMessage);
    }

    sendRealtimeInputMessage(data, mime_type) {
        const message = {
            realtime_input: {
                media_chunks: [
                    {
                        mime_type: mime_type,
                        data: data,
                    },
                ],
            },
        };
        this.sendMessage(message);
    }

    sendAudioMessage(base64PCM) {
        this.sendRealtimeInputMessage(base64PCM, "audio/pcm");
    }

    sendImageMessage(base64Image, mime_type = "image/jpeg") {
        this.sendRealtimeInputMessage(base64Image, mime_type);
    }
}

console.log("loaded gemini-live-api.js");
