import asyncio
import json

import websockets
from websockets.legacy.protocol import WebSocketCommonProtocol
from websockets.legacy.server import WebSocketServerProtocol
import google.auth
import google.auth.transport.requests

HOST = "us-central1-aiplatform.googleapis.com"
SERVICE_URL = f"wss://{HOST}/ws/google.cloud.aiplatform.v1beta1.LlmBidiService/BidiGenerateContent"

DEBUG = False

GCP_SCOPE = ['https://www.googleapis.com/auth/cloud-platform']

async def get_gcp_token() -> str:
    """
    Gets a bearer token from the Google Cloud service account.

    This uses Application Default Credentials (ADC), which will automatically
    find the service account when running on GCP (Cloud Run, GCE, GKE, etc.).

    Returns:
        The access token string.
        
    Raises:
        google.auth.exceptions.DefaultCredentialsError: If no credentials
            could be found.
    """
    print("Generating GCP access token...")
    # The default() method finds the credentials from the environment.
    credentials, project_id = google.auth.default(scopes=GCP_SCOPE)
    
    print("The credentials need to be refreshed to get the actual access token.")
    auth_req = google.auth.transport.requests.Request()
    print(f"now reresh")
    credentials.refresh(auth_req)
    
    print("Successfully generated token.")
    return credentials.token

async def proxy_task(
    client_websocket: WebSocketCommonProtocol, server_websocket: WebSocketCommonProtocol
) -> None:
    """
    Forwards messages from one WebSocket connection to another.

    Args:
        client_websocket: The WebSocket connection from which to receive messages.
        server_websocket: The WebSocket connection to which to send messages.
    """
    async for message in client_websocket:
        try:
            data = json.loads(message)
            if DEBUG:
                print("proxying: ", data)
            await server_websocket.send(json.dumps(data))
        except Exception as e:
            print(f"Error processing message: {e}")

    await server_websocket.close()


async def create_proxy(
    client_websocket: WebSocketCommonProtocol, bearer_token: str
) -> None:
    """
    Establishes a WebSocket connection to the server and creates two tasks for
    bidirectional message forwarding between the client and the server.

    Args:
        client_websocket: The WebSocket connection of the client.
        bearer_token: The bearer token for authentication with the server.
    """

    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {bearer_token}",
    }

    async with websockets.connect(
        SERVICE_URL, additional_headers=headers
    ) as server_websocket:
        client_to_server_task = asyncio.create_task(
            proxy_task(client_websocket, server_websocket)
        )
        server_to_client_task = asyncio.create_task(
            proxy_task(server_websocket, client_websocket)
        )
        await asyncio.gather(client_to_server_task, server_to_client_task)


async def handle_client(client_websocket: WebSocketServerProtocol) -> None:
    """
    Handles a new client connection, expecting the first message to contain a bearer token.
    Establishes a proxy connection to the server upon successful authentication.

    Args:
        client_websocket: The WebSocket connection of the client.
    """
    print("New connection...")
    # Wait for the first message from the client
    try:
        # Instead of waiting for a token from the client, generate one now.
        print("Getting Bearer token...")
        bearer_token = await get_gcp_token()

        #this came from the UI initially and set the variable
        #print(f"Bearer token: {bearer_token}")

        # The original code expected an initial message for auth.
        # You might still need to consume an initial message from the client
        # if it sends one (e.g., with session setup info). If the client
        # now sends its setup message first, you can receive it here.
        #
        # For example, if the client sends a setup message right away:
        # initial_client_message = await client_websocket.recv()
        # print(f"Received initial message from client: {initial_client_message}")

        # Now, create the proxy with the generated token
        # gcloud auth print-access-token
        #bearer_token = ""
        await create_proxy(client_websocket, bearer_token)

    except google.auth.exceptions.DefaultCredentialsError:
        print("Error: Could not find Google Cloud credentials.")
        await client_websocket.close(code=1011, reason="Server authentication error")
        return
    except Exception as e:
        print(f"An unexpected error occurred: {e}")
        await client_websocket.close(code=1011, reason="Internal server error")
        return


async def main() -> None:
    """
    Starts the WebSocket server and listens for incoming client connections.
    """
    async with websockets.serve(handle_client, "localhost", 8080):
        print("Running websocket server localhost:8080...")
        # Run forever
        await asyncio.Future()


if __name__ == "__main__":
    asyncio.run(main())
