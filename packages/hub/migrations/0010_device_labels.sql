-- The name a device is shown with ('PC1'), apart from its name, which is the key of its data and
-- never changes. Several devices can share a label: the agent and the Deuchan of one computer.
ALTER TABLE devices ADD COLUMN label TEXT;
