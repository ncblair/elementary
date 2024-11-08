import OfflineRenderer from "../index";
import { el } from "@elemaudio/core";

test("mc table", async function () {
  let core = new OfflineRenderer();

  await core.initialize({
    numInputChannels: 0,
    numOutputChannels: 1,
    virtualFileSystem: {
      "/v/ones": Float32Array.from([1, 1, 1]),
      "/v/stereo": [
        Float32Array.from([27, 27, 27]),
        Float32Array.from([15, 15, 15]),
      ],
    },
  });

  // Graph
  await core.render(
    el.add(...el.mc.table({ path: "/v/stereo", channels: 2 }, 0)),
  );

  // Ten blocks of data
  let inps = [];
  let outs = [new Float32Array(512 * 10)];

  // Get past the fade-in
  core.process(inps, outs);

  // Process another small block
  inps = [];
  outs = [new Float32Array(16)];

  core.process(inps, outs);

  expect(outs[0]).toMatchSnapshot();

  // Let's try a graph unpacking more channels than the resource has
  await core.render(
    el.add(...el.mc.table({ path: "/v/stereo", channels: 3 }, 0)),
  );

  // Get past the fade-in
  for (let i = 0; i < 100; ++i) {
    core.process(inps, outs);
  }

  // Process another small block
  core.process(inps, outs);
  expect(outs[0]).toMatchSnapshot();

  // And again unpacking fewer channels
  await core.render(
    el.add(...el.mc.table({ path: "/v/stereo", channels: 1 }, 0)),
  );

  // Get past the fade-in
  for (let i = 0; i < 100; ++i) {
    core.process(inps, outs);
  }

  // Process another small block
  core.process(inps, outs);
  expect(outs[0]).toMatchSnapshot();

  // Now here we expect that the first graph has been totally nudged out
  // of relevance, except for the nodes that remain shared which are the table
  // and the const 0. If we gc then, we should remove that add() and root() from
  // the original graph.
  expect(await core.gc()).toEqual([1611541315, 1811703364]);

  // But now the act of removing that add node should have pruned the outlet connections
  // list on the table node. We'll test that original graph again to ensure that after
  // rebuilding that connection everything still looks good.
  await core.render(
    el.add(...el.mc.table({ path: "/v/stereo", channels: 2 }, 0)),
  );

  // Get past the fade-in
  for (let i = 0; i < 100; ++i) {
    core.process(inps, outs);
  }

  // Process another small block
  core.process(inps, outs);
  expect(outs[0]).toMatchSnapshot();
});

test("mc sampleseq", async function () {
  let core = new OfflineRenderer();

  await core.initialize({
    numInputChannels: 0,
    numOutputChannels: 1,
    virtualFileSystem: {
      "/v/stereo": [
        Float32Array.from(Array.from({ length: 128 }).fill(27)),
        Float32Array.from(Array.from({ length: 128 }).fill(15)),
      ],
    },
  });

  let [time, setTimeProps] = core.createRef("const", { value: 0 }, []);

  core.render(
    el.add(
      ...el.mc.sampleseq(
        {
          path: "/v/stereo",
          channels: 2,
          duration: 128,
          seq: [
            { time: 0, value: 0 },
            { time: 128, value: 1 },
            { time: 256, value: 0 },
            { time: 512, value: 1 },
          ],
        },
        time,
      ),
    ),
  );

  // Ten blocks of data to get past the root node fade
  let inps = [];
  let outs = [new Float32Array(10 * 512)];

  // Get past the fade-in
  core.process(inps, outs);

  // Now we expect to see zeros because we're fixed at time 0
  outs = [new Float32Array(32)];
  core.process(inps, outs);
  expect(outs[0]).toMatchSnapshot();

  // Jump in time
  setTimeProps({ value: 520 });

  // Spin for a few blocks and we should see the gain fade resolve and
  // emit the constant sum of the two channels
  for (let i = 0; i < 10; ++i) {
    core.process(inps, outs);
  }

  expect(outs[0]).toMatchSnapshot();
});

test("mc capture", async function () {
  let core = new OfflineRenderer();

  await core.initialize({
    numInputChannels: 0,
    numOutputChannels: 4,
    blockSize: 32,
  });

  let [gate, setGateProps] = core.createRef("const", { value: 0 }, []);

  core.render(
    ...el.mc.capture({ name: "test", channels: 4 }, gate, 1, 2, 3, 4),
  );

  // Ten blocks of data to get past the root node fade
  let inps = [];
  let outs = [
    new Float32Array(32),
    new Float32Array(32),
    new Float32Array(32),
    new Float32Array(32),
  ];

  // Get past the fade-in
  for (let i = 0; i < 1000; ++i) {
    core.process(inps, outs);
  }

  let eventCallback = jest.fn();
  core.on("mc.capture", eventCallback);

  setGateProps({ value: 1 });
  core.process(inps, outs);
  expect(outs).toMatchSnapshot();

  setGateProps({ value: 0 });
  core.process(inps, outs);

  expect(eventCallback.mock.calls).toHaveLength(1);
  let args = eventCallback.mock.calls[0];
  let evt = args[0];

  expect(evt.data).toHaveLength(4);
  expect(evt.source).toBe("test");

  for (let i = 0; i < 4; ++i) {
    expect(evt.data[i]).toHaveLength(32);

    for (let j = 0; j < 32; ++j) {
      expect(evt.data[i][j]).toBe(i + 1);
    }
  }
});
