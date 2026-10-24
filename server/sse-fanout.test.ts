import { createServer, type ServerResponse } from "node:http";
import { connect, type AddressInfo, type Socket } from "node:net";
import { setTimeout as sleep } from "node:timers/promises";

import { afterEach, describe, expect, it, vi } from "vitest";

import { deliverSseFrame, openSseHeartbeat, SSE_MAX_BUFFERED_BYTES, type SseFanoutClient } from "./sse-fanout.ts";

type TestClient = SseFanoutClient & { drains: (() => void)[] };

function fakeClient(resOverrides: Partial<SseFanoutClient["res"]> = {}): TestClient {
  const drains: (() => void)[] = [];
  return {
    backpressured: false,
    drains,
    res: {
      writableLength: 0,
      write: () => true,
      end: () => {},
      once: (_event: "drain", listener: () => void) => drains.push(listener),
      ...resOverrides,
    },
  };
}

describe("deliverSseFrame", () => {
  it("sends normally while write() returns true", () => {
    const client = fakeClient();
    expect(deliverSseFrame(client, "message", "frame-a")).toBe("sent");
    expect(client.backpressured).toBe(false);
  });

  it("marks the client backpressured when write() returns false, without dropping that frame", () => {
    const client = fakeClient({ write: () => false });
    expect(deliverSseFrame(client, "message", "frame-a")).toBe("sent");
    expect(client.backpressured).toBe(true);
  });

  it("drops a replaceable screen frame once backpressured, but never drops a durable event", () => {
    const written: string[] = [];
    const client = fakeClient({
      write: (chunk: string) => {
        written.push(chunk);
        return false;
      },
    });

    expect(deliverSseFrame(client, "screen", "screen-1")).toBe("sent");
    expect(client.backpressured).toBe(true);

    expect(deliverSseFrame(client, "screen", "screen-2")).toBe("dropped");

    expect(deliverSseFrame(client, "message", "message-1")).toBe("sent");

    expect(written).toEqual(["screen-1", "message-1"]);
  });

  it("disconnects a client once buffered bytes exceed the bound, even for a durable event", () => {
    let ended = false;
    const client = fakeClient({
      writableLength: SSE_MAX_BUFFERED_BYTES + 1,
      end: () => {
        ended = true;
      },
    });
    expect(deliverSseFrame(client, "message", "message-1")).toBe("disconnected");
    expect(ended).toBe(true);
  });

  it("resumes screen frames once the socket drains", () => {
    // A single screen frame exceeds the 16 KB highWaterMark, so even a healthy client's write() returns false.
    let full = true;
    const client = fakeClient({ write: () => !full });

    expect(deliverSseFrame(client, "screen", "screen-1")).toBe("sent");
    expect(client.backpressured).toBe(true);
    expect(deliverSseFrame(client, "screen", "screen-2")).toBe("dropped");
    expect(client.drains).toHaveLength(1);

    full = false;
    for (const drain of client.drains) drain();

    expect(client.backpressured).toBe(false);
    expect(deliverSseFrame(client, "screen", "screen-3")).toBe("sent");
  });

  it("queues one drain listener per backpressure episode, not per frame", () => {
    const client = fakeClient({ write: () => false });

    deliverSseFrame(client, "message", "message-1");
    deliverSseFrame(client, "message", "message-2");
    deliverSseFrame(client, "message", "message-3");

    expect(client.backpressured).toBe(true);
    expect(client.drains).toHaveLength(1);
  });

  it("treats a throwing write() as a dead connection", () => {
    const client = fakeClient({
      write: () => {
        throw new Error("socket hang up");
      },
    });
    expect(deliverSseFrame(client, "message", "message-1")).toBe("disconnected");
  });
});

describe("openSseHeartbeat", () => {
  const opened: { close(): void }[] = [];
  afterEach(() => {
    for (const each of opened.splice(0)) each.close();
  });

  /** A response whose client never reads, so ending it leaves bytes queued and the request never sees "close". */
  async function stalledStream() {
    const server = createServer();
    const response = new Promise<ServerResponse>((resolve) => server.once("request", (_req, res) => resolve(res)));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const socket: Socket = connect((server.address() as AddressInfo).port, "127.0.0.1");
    opened.push({ close: () => { socket.destroy(); server.closeAllConnections(); server.close(); } });
    socket.pause();
    socket.write("GET /api/events HTTP/1.1\r\nhost: 127.0.0.1\r\n\r\n");
    const res = await response;
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write(`data: ${"x".repeat(16 * 1024 * 1024)}\n\n`);
    const errors: Error[] = [];
    const writesAfterEnd: string[] = [];
    const write = res.write.bind(res) as (chunk: string) => boolean;
    res.write = ((chunk: string) => {
      if (res.writableEnded) writesAfterEnd.push(chunk);
      return write(chunk);
    }) as typeof res.write;
    return { res, errors, writesAfterEnd, recordErrors: () => res.on("error", (error) => errors.push(error)) };
  }

  it("stops and leaves before ending the response when the session stops being live, with the socket still open", async () => {
    const stream = await stalledStream();
    let live = true;
    const onClose = vi.fn(() => expect(stream.res.writableEnded).toBe(false));
    openSseHeartbeat(stream.res, { everyMs: 10, live: () => live, onClose });
    stream.recordErrors();
    await sleep(35);
    live = false;
    await vi.waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    await sleep(60);
    expect(stream.res.writableEnded).toBe(true);
    expect(stream.res.writableFinished).toBe(false);
    expect(onClose).toHaveBeenCalledOnce();
    expect(stream.writesAfterEnd).toEqual([]);
    expect(stream.errors).toEqual([]);
  });

  it("never writes after another path ended the response while its socket stayed open", async () => {
    const stream = await stalledStream();
    const onClose = vi.fn();
    openSseHeartbeat(stream.res, { everyMs: 10, live: () => true, onClose });
    stream.recordErrors();
    await sleep(25);
    stream.res.end();
    await sleep(60);
    expect(stream.res.writableFinished).toBe(false);
    expect(onClose).toHaveBeenCalledOnce();
    expect(stream.writesAfterEnd).toEqual([]);
    expect(stream.errors).toEqual([]);
  });

  it("keeps the process up when a write on the response fails", async () => {
    const stream = await stalledStream();
    const onClose = vi.fn();
    const close = openSseHeartbeat(stream.res, { everyMs: 1000, live: () => true, onClose });
    stream.res.end();
    stream.res.write("late frame\n\n");
    await vi.waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    close();
    expect(onClose).toHaveBeenCalledOnce();
  });
});
