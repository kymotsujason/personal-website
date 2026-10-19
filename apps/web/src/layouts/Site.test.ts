import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { expect, test, vi } from "vitest";
import Site from "./Site.astro";

vi.mock("../lib/projects", () => ({
  latestProject: async () => ({
    title: "</script><b>closing tag",
    slug: "closing-tag",
  }),
}));

test("site-data keeps a less than sign from ending its script element", async () => {
  const container = await AstroContainer.create({
    astroConfig: { site: "https://jasonyue.ca" },
  });
  const html = await container.renderToString(Site, {
    props: { title: "Test", description: "Test" },
    request: new Request("https://jasonyue.ca/about"),
  });
  const match =
    /<script type="application\/json" id="site-data">([\s\S]*?)<\/script>/.exec(
      html,
    );
  expect(match).not.toBeNull();
  expect(match![1]).not.toContain("<");
  const data = JSON.parse(match![1]);
  expect(data.latestProject.title).toBe("</script><b>closing tag");
});
