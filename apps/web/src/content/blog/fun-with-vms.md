---
title: "Fun with VMs"
date: "2019-07-28T00:00:00.000-07:00"
slug: "fun-with-vms"
feature_image: "/blog/content/images/2019/12/Annotation-2019-12-07-164921.png"
thumb: "/blog/thumbs/fun-with-vms.jpg"
---

Recently, I built my own home server by pairing server grade equipment with consumer grade equipment. I did have some issues with getting the motherboard in the case (E-ATX motherboard), but luckily the case was very modular.

Before this build, I had never heard of IPMI before. However, now I think it's the best thing that can ever happen to a computer. Being able to control a computer using IPMI and KVM all through a single ethernet cable is very convenient. Even though I'm an IT Engineer, I hadn't quite thought about how rack servers were remotely managed until I came across IPMI. I know there are other types of solutions like iDRAC, but didn't quite fully grasp it until IPMI. It even lets me mount ISO files through the network. This is also how I installed ESXi to begin playing around with the hardware.

ESXi is a pretty popular solution for hosting multiple OS on a single server. It's a pretty sleek hypervisor and is quite easy to manage. I didn't think it was plug and play, but it basically was that easy to setup. I'm currently running 6 VMs for testing and hosting. I played around with an open source router based solution called OPNsense, which gave me a great deal of control over the network and was certainly very easy to setup and control. Though, in the end I decided to stick with a physical router, since I haven't tested the long term stability of my VM host yet.

What's a server without a storage solution? One of my VMs is FreeNAS, which is another open source solution for hosting a large amount of storage through the network. Since I was hosting everything on a single VM, I had to pass through my Seagate IronWolf drives to the VM hosting the FreeNAS OS. Luckily, it wasn't difficult, since all I really had to do was go into the SSH console and enter a few commands to map the drives to the VM. I'm sure there was probably an easier way, but this was quite convenient. Most of my VMs are Ubuntu Servers, since it's so popular and has a lot of support. I'll be hosting game servers, websites, and running some AI labs for learning purposes. I've also got a Windows Server running, though I've yet to figure out a purpose for the VM. It could do some graphic intensive work, since I've passed a GPU through to the OS, though I'm not sure whether it'll work or not. In any case, I hope that having this home server will further my knowledge in development techniques and frameworks. It's always great to have options.
